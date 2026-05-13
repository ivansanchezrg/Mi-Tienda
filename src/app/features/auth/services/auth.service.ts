import { Injectable, inject, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular/standalone';
import { Preferences } from '@capacitor/preferences';
import { BehaviorSubject } from 'rxjs';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '@core/services/supabase.service';
import { UiService } from '@core/services/ui.service';
import { LoggerService } from '@core/services/logger.service';
import { environment } from '../../../../environments/environment';
import { UsuarioActual } from '../models/usuario-actual.model';
import { ROUTES } from '@core/config/routes.config';

/** Negocio disponible para el selector de negocio activo */
export interface NegocioDisponible {
  negocio_id: string;
  negocio_nombre: string;
  rol: 'ADMIN' | 'EMPLEADO';
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private supabase = inject(SupabaseService);
  private router = inject(Router);
  private ui = inject(UiService);
  private alertCtrl = inject(AlertController);
  private logger = inject(LoggerService);
  private zone = inject(NgZone);

  // Key de storage de Supabase: sb-{projectRef}-auth-token
  private readonly STORAGE_KEY: string;
  private readonly USUARIO_KEY = 'usuario_actual';
  /**
   * Flag persistido en Preferences que indica que el usuario completó
   * una autenticación OAuth activa en esta instalación.
   * Se escribe al completar login (activarNegocio / onboarding).
   * Se borra en logout/handleExpiredSession via registerBeforeCleanup.
   * Permite al authGuard distinguir "sesión persistida de antes" de
   * "usuario que ya eligió su cuenta en esta instalación".
   */
  private readonly AUTENTICADO_KEY = 'sesion_autenticada';

  /**
   * Canal de Realtime del usuario actual (tabla `usuarios`).
   * Detecta suspensión global (activo=false) y eliminación del usuario.
   * Abierto tras activarNegocio() exitoso, cerrado en cerrarRealtimeCanales().
   */
  private canalUsuario: RealtimeChannel | null = null;
  private canalUsuarioId: string | null = null;

  /**
   * Canal de Realtime de la membresía activa (tabla `usuario_negocios`).
   * Detecta cuando un ADMIN desactiva la membresía del usuario en el negocio actual.
   * Se abre junto con canalUsuario y se cierra en el mismo cleanup.
   */
  private canalMembresia: RealtimeChannel | null = null;
  private canalMembresiaKey: string | null = null;

  /**
   * Lista de negocios disponibles para el usuario tras login exitoso.
   * Se usa en SelectorNegocioPage cuando el usuario tiene 2+ negocios.
   * Se limpia tras activar un negocio.
   */
  negociosDisponibles: NegocioDisponible[] = [];

  /**
   * Observable reactivo del usuario actual.
   * Emite cada vez que el usuario cambia (login, cambio de rol via Realtime, logout).
   * El sidebar se suscribe para actualizar rol, menú y UI sin refrescar.
   */
  private readonly _usuarioActual$ = new BehaviorSubject<UsuarioActual | null>(null);
  readonly usuarioActual$ = this._usuarioActual$.asObservable();

  /** Valor sincronico del usuario actual (util en codigo imperativo). */
  get usuarioActualValue(): UsuarioActual | null {
    return this._usuarioActual$.value;
  }

  /**
   * Flag que indica si validarUsuario() ya se ejecutó exitosamente en esta sesión.
   * Se resetea a false en handleExpiredSession() (via cleanup) y handleUsuarioDesactivado().
   *
   * Permite que authGuard llame validarUsuario() en la primera navegación y use
   * cache + Realtime en las siguientes (sin query HTTP adicional).
   */
  private validadoEnEstaSesion = false;

  /**
   * Base del usuario validado (sin negocio) — guardado temporalmente para
   * que activarNegocio() pueda construir el UsuarioActual completo.
   */
  private usuarioBase: { id: string; nombre: string; email: string; es_superadmin: boolean } | null = null;

  constructor() {
    const projectRef = environment.supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || '';
    this.STORAGE_KEY = `sb-${projectRef}-auth-token`;

    // Registrar cleanup del canal de Realtime ante cualquier expiración/logout.
    // Esto evita websockets huérfanos cuando la sesión se cierra por cualquier vía.
    this.supabase.registerBeforeCleanup(() => this.cerrarRealtimeUsuario());
    // Borrar el flag de autenticación activa al cerrar sesión.
    this.supabase.registerBeforeCleanup(() =>
      Preferences.remove({ key: this.AUTENTICADO_KEY }).catch(() => {})
    );
  }

  /**
   * Verifica si el usuario ya fue validado contra la BD en esta sesión.
   * Usado por authGuard para evitar consultas HTTP en cada navegación.
   */
  get yaValidadoEnEstaSesion(): boolean {
    return this.validadoEnEstaSesion;
  }

  /**
   * Marca explicitamente la sesion actual como ya validada.
   * Usado por superadminGuard cuando detecta acceso valido al panel admin
   * (ej: F5 en /admin con UsuarioActual cacheado), para que el authGuard de
   * navegaciones posteriores (/crear-negocio, etc.) no re-dispare validarUsuario().
   */
  markValidatedInSession(): void {
    this.validadoEnEstaSesion = true;
  }

  /**
   * Verifica si el usuario completó una autenticación OAuth activa
   * en esta instalación (no es solo una sesión persistida de antes).
   * Persistido en Preferences — sobrevive kill/reopen de la app pero
   * se borra en logout.
   */
  async hasActiveAuth(): Promise<boolean> {
    const { value } = await Preferences.get({ key: this.AUTENTICADO_KEY });
    return value === 'true';
  }

  /**
   * Verifica si hay sesión guardada localmente (sin llamada de red).
   * Útil para el guard cuando no hay internet.
   */
  hasLocalSession(): boolean {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return false;
      const parsed = JSON.parse(stored);
      return !!parsed?.access_token;
    } catch {
      return false;
    }
  }

  /** Retorna la sesión actual o null */
  async getSession() {
    const { data } = await this.supabase.client.auth.getSession();
    return data.session;
  }

  /** Retorna el usuario actual o null */
  async getUser() {
    const session = await this.getSession();
    return session?.user ?? null;
  }

  // ==========================================
  // VALIDACIÓN DE USUARIO — flujo multi-tenant
  // ==========================================

  /**
   * Valida que el email exista en la tabla `usuarios` y esté activo.
   *
   * Flujo v11 (multi-tenant):
   *  1. No existe → auto-registro (solo email + nombre) → /auth/pending
   *  2. Existe, 0 negocios activos → /onboarding/negocio
   *  3. Existe, 1 negocio  → activarNegocio() directamente → /home
   *  4. Existe, N negocios → guardar lista → /auth/seleccionar-negocio
   */
  async validarUsuario(): Promise<boolean> {
    const user = await this.getUser();
    if (!user?.email) {
      this.logger.warn('AuthService', 'validarUsuario: no hay usuario o email en sesión');
      await this.forceLogout();
      return false;
    }

    const { data, error } = await this.supabase.client
      .from('usuarios')
      .select('id, nombre, email, es_superadmin, activo')
      .eq('email', user.email)
      .maybeSingle();

    if (error) {
      this.logger.error('AuthService', 'Error al consultar usuario en BD', error);
      await this.ui.showError('Error al verificar tu cuenta. Intentá de nuevo.');
      await this.forceLogout();
      return false;
    }

    // Usuario suspendido globalmente (activo = false) — excepto superadmin
    if (data && data.activo === false && !data.es_superadmin) {
      this.logger.warn('AuthService', 'Usuario suspendido — redirigiendo a pending');
      this.router.navigate([ROUTES.auth.pending], { replaceUrl: true, queryParams: { motivo: 'usuario' } });
      return false;
    }

    // Usuario no existe → auto-registro mínimo
    // En v11: sin activo/rol → viven en usuario_negocios
    if (!data) {
      this.logger.info('AuthService', 'Auto-registro de nuevo usuario');
      const nombre = user.user_metadata?.['full_name']
        || user.user_metadata?.['name']
        || user.email.split('@')[0];

      const { error: insertError } = await this.supabase.client
        .from('usuarios')
        .insert({ nombre, email: user.email });

      if (insertError) {
        this.logger.error('AuthService', 'Error al auto-registrar usuario', insertError);
        await this.ui.showError('Error al registrar tu cuenta. Intentá de nuevo.');
        await this.forceLogout();
        return false;
      }

      await Preferences.set({ key: this.AUTENTICADO_KEY, value: 'true' });
      this.router.navigate([ROUTES.onboarding.negocio], { replaceUrl: true });
      return false;
    }

    // Guardar base del usuario para uso en activarNegocio()
    this.usuarioBase = {
      id: data.id,
      nombre: data.nombre,
      email: data.email,
      es_superadmin: data.es_superadmin ?? false
    };

    // Iniciar Realtime del usuario tan pronto como se confirma su identidad.
    // Cubre pantallas intermedias (selector, onboarding) antes de activar un negocio.
    // Es idempotente — si activarNegocio() lo vuelve a llamar con el mismo id, no abre segundo canal.
    if (!data.es_superadmin) {
      this.iniciarRealtimeUsuario(data.id);
    }

    // Obtener membresías activas del usuario
    // Obtener TODAS las membresías (activas e inactivas) para distinguir
    // "usuario nuevo sin negocios" de "usuario desactivado en todos sus negocios"
    const { data: membresias, error: errNegocios } = await this.supabase.client
      .from('usuario_negocios')
      .select('negocio_id, rol, activo, negocio:negocios(nombre)')
      .eq('usuario_id', data.id);

    if (errNegocios) {
      this.logger.error('AuthService', 'Error al obtener negocios del usuario', errNegocios);
      await this.ui.showError('Error al cargar tus negocios. Intentá de nuevo.');
      await this.forceLogout();
      return false;
    }

    const todasMembresias = membresias || [];
    const negocios: NegocioDisponible[] = todasMembresias
      .filter((m: any) => m.activo)
      .map((m: any) => ({
        negocio_id:     m.negocio_id,
        negocio_nombre: m.negocio?.nombre ?? 'Sin nombre',
        rol:            m.rol as 'ADMIN' | 'EMPLEADO'
      }));

    // Recarga de página / app resume: si hay un UsuarioActual guardado en
    // Preferences con un negocio que sigue siendo válido, re-activar directo
    // sin mostrar el selector. En login fresco, Preferences está vacío (se
    // limpió en handleExpiredSession) → siempre pasa por el flujo normal.
    const cached = await this.getUsuarioActual();
    if (cached?.negocio_id) {
      // Para superadmin: puede tener negocio cacheado sin tener membresía en usuario_negocios.
      // En ese caso yaActivo sería undefined aunque el negocio sea válido.
      // Re-activar directo usando el cache si el negocio existe en la lista O si es superadmin.
      const yaActivo = negocios.find(n => n.negocio_id === cached.negocio_id);
      if (yaActivo) {
        this.logger.info('AuthService', `Sesión previa detectada: ${yaActivo.negocio_nombre}. Re-activando directo.`);
        await this.activarNegocio(yaActivo, false);
        return true;
      }
      if (this.usuarioBase?.es_superadmin) {
        this.logger.info('AuthService', `Superadmin con negocio cacheado sin membresía: ${cached.negocio_nombre}. Re-activando directo.`);
        await this.activarNegocio({ negocio_id: cached.negocio_id, negocio_nombre: cached.negocio_nombre, rol: 'ADMIN' }, false);
        return true;
      }
    }

    // Superadmin sin negocio cacheado → SIEMPRE al panel admin,
    // independientemente de cuántas membresías propias tenga.
    // Desde /admin elige a qué negocio entrar.
    if (this.usuarioBase?.es_superadmin) {
      this.logger.info('AuthService', 'Superadmin en login fresco → panel admin');

      // Guardar en Preferences para que superadminGuard pueda verificar es_superadmin
      // (sin esto, getUsuarioActual() devuelve null y el guard bloquea el acceso)
      const usuarioAdmin: UsuarioActual = {
        id: this.usuarioBase.id,
        nombre: this.usuarioBase.nombre,
        email: this.usuarioBase.email,
        activo: true,
        rol: 'ADMIN',
        es_superadmin: true,
        negocio_id: '',
        negocio_nombre: ''
      };
      await this.saveUsuarioActual(usuarioAdmin);

      this.validadoEnEstaSesion = true;
      this.router.navigate([ROUTES.admin], { replaceUrl: true });
      return true;
    }

    if (negocios.length === 0) {
      if (todasMembresias.length > 0) {
        // Tiene membresías pero todas inactivas → fue desactivado manualmente o transferido
        this.logger.info('AuthService', 'Usuario con membresías todas inactivas → /auth/pending');
        this.router.navigate([ROUTES.auth.pending], { replaceUrl: true, queryParams: { motivo: 'membresia' } });
      } else {
        // Nunca tuvo membresías → usuario nuevo sin negocio asignado
        this.logger.info('AuthService', 'Usuario sin negocios — redirigiendo a crear-negocio');
        this.router.navigate([ROUTES.onboarding.negocio], { replaceUrl: true });
      }
      return false;
    }

    if (negocios.length === 1) {
      this.logger.info('AuthService', `1 negocio. Activando: ${negocios[0].negocio_id}`);
      await this.activarNegocio(negocios[0]);
      return true;
    }

    // Múltiples negocios → mostrar selector
    this.logger.info('AuthService', `${negocios.length} negocios encontrados. Redirigiendo a selector.`);
    this.negociosDisponibles = negocios;
    this.router.navigate([ROUTES.auth.seleccionarNegocio], { replaceUrl: true });
    return false;
  }

  /**
   * Activa un negocio para el usuario actual.
   *  1. RPC fn_set_negocio_activo → escribe negocio_id + rol en JWT app_metadata
   *  2. refreshSession() → el cliente recibe el JWT actualizado con RLS aplicadas
   *  3. Guarda UsuarioActual completo en Preferences y emite en usuarioActual$
   *  4. Inicia Realtime
   *  5. Redirige a /home
   *
   * Llamado por: validarUsuario() (1 negocio) y SelectorNegocioPage (N negocios).
   */
  async activarNegocio(negocio: NegocioDisponible, navegarAlInicio = true): Promise<void> {
    // Recuperar usuarioBase si se perdió (recarga de página)
    if (!this.usuarioBase) {
      const user = await this.getUser();
      if (!user?.email) {
        this.logger.error('AuthService', 'activarNegocio: no hay sesión');
        await this.forceLogout();
        return;
      }
      const { data } = await this.supabase.client
        .from('usuarios')
        .select('id, nombre, email, es_superadmin')
        .eq('email', user.email)
        .maybeSingle();

      if (!data) {
        this.logger.error('AuthService', 'activarNegocio: usuario no encontrado en BD');
        await this.forceLogout();
        return;
      }
      this.usuarioBase = {
        id: data.id,
        nombre: data.nombre,
        email: data.email,
        es_superadmin: data.es_superadmin ?? false
      };
    }

    const { error: rpcError } = await this.supabase.client
      .rpc('fn_set_negocio_activo', { p_negocio_id: negocio.negocio_id });

    if (rpcError) {
      this.logger.error('AuthService', 'Error en fn_set_negocio_activo', rpcError);
      const msg = (rpcError.message ?? '').toLowerCase();
      if (msg.includes('suspendido y no puede acceder')) {
        await this.ui.showError('Tu cuenta está suspendida. Contacta al administrador.');
      } else {
        await this.ui.showError('Error al activar el negocio. Intenta de nuevo.');
      }
      return;
    }

    // Refrescar sesión para que el JWT incluya el nuevo negocio_id + rol
    // Las RLS de todas las tablas dependen de get_negocio_id() que lee el JWT.
    const { error: refreshError } = await this.supabase.client.auth.refreshSession();
    if (refreshError) {
      this.logger.error('AuthService', 'Error al refrescar sesión', refreshError);
      await this.ui.showError('Error al actualizar tu sesión. Intentá de nuevo.');
      return;
    }

    const usuarioCompleto: UsuarioActual = {
      id: this.usuarioBase.id,
      nombre: this.usuarioBase.nombre,
      email: this.usuarioBase.email,
      activo: true,
      rol: negocio.rol,
      es_superadmin: this.usuarioBase.es_superadmin,
      negocio_id: negocio.negocio_id,
      negocio_nombre: negocio.negocio_nombre
    };

    await this.saveUsuarioActual(usuarioCompleto);
    await Preferences.set({ key: this.AUTENTICADO_KEY, value: 'true' });
    this.iniciarRealtimeUsuario(this.usuarioBase.id);
    this.iniciarRealtimeMembresia(this.usuarioBase.id, negocio.negocio_id);
    this.validadoEnEstaSesion = true;
    this.negociosDisponibles = [];
    this.usuarioBase = null;

    this.logger.info('AuthService', `Negocio activado: ${negocio.negocio_nombre} (${negocio.rol})`);
    if (navegarAlInicio) {
      this.router.navigate([ROUTES.home], { replaceUrl: true });
    }
  }

  // ==========================================
  // REALTIME — Monitorear cambios en el usuario actual
  // ==========================================

  /**
   * Abre un canal de Realtime que escucha cambios en el registro del usuario
   * actual en la tabla `usuarios`.
   * - UPDATE activo=false → handleUsuarioDesactivado() → /auth/pending (sesión OAuth intacta)
   * - DELETE → handleExpiredSession() → /auth/login
   * - UPDATE otros campos (nombre, etc.) → actualiza cache + emite en usuarioActual$
   *
   * Es idempotente: si ya hay un canal abierto para el mismo usuario, no hace nada.
   */
  iniciarRealtimeUsuario(id: string): void {
    if (this.canalUsuario && this.canalUsuarioId === id) return;
    if (this.canalUsuario) this.cerrarRealtimeUsuario();

    try {
      const canal = this.supabase.client
        .channel(`usuario-activo-${id}`)
        .on(
          'postgres_changes' as any,
          { event: 'UPDATE', schema: 'public', table: 'usuarios', filter: `id=eq.${id}` },
          (payload: any) => {
            this.zone.run(async () => {
              const nuevo = payload.new as Partial<UsuarioActual> | null;
              if (!nuevo) return;

              // Caso 1: usuario desactivado → sacar de la app (conservar sesión OAuth)
              if (nuevo.activo === false) {
                this.logger.warn('AuthService', 'Usuario desactivado en tiempo real');
                await this.handleUsuarioDesactivado();
                return;
              }

              // Caso 2: cambio de nombre u otros campos → actualizar cache + UI
              this.logger.info('AuthService', 'Datos del usuario actualizados en tiempo real');
              const actual = await this.getUsuarioActual();
              if (actual) {
                const actualizado: UsuarioActual = {
                  ...actual,
                  id: nuevo.id ?? actual.id,
                  nombre: nuevo.nombre ?? actual.nombre,
                  activo: nuevo.activo ?? actual.activo,
                  es_superadmin: (nuevo as any).es_superadmin ?? actual.es_superadmin
                };
                await this.saveUsuarioActual(actualizado);
              }
            });
          }
        )
        .on(
          'postgres_changes' as any,
          { event: 'DELETE', schema: 'public', table: 'usuarios', filter: `id=eq.${id}` },
          () => {
            this.zone.run(async () => {
              this.logger.warn('AuthService', 'Usuario eliminado en tiempo real');
              await this.ui.showError('Tu cuenta fue eliminada por un administrador');
              await this.supabase.handleExpiredSession();
            });
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            this.logger.info('AuthService', 'Realtime usuario suscrito');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            this.logger.error('AuthService', `Realtime usuario falló: ${status}`);
          }
        });

      this.canalUsuario = canal;
      this.canalUsuarioId = id;
    } catch (err) {
      // No bloquear el flujo de login si Realtime falla — las otras capas siguen activas.
      this.logger.error('AuthService', 'Error al iniciar Realtime del usuario', err);
      this.canalUsuario = null;
      this.canalUsuarioId = null;
    }
  }

  /**
   * Abre un canal de Realtime que escucha cambios en la membresía activa del
   * usuario en el negocio actual (tabla `usuario_negocios`).
   *
   * - UPDATE activo=false → handleUsuarioDesactivado() con motivo 'membresia'
   *   (el ADMIN desactivó al usuario en este negocio)
   *
   * Es idempotente: si ya existe un canal para la misma clave usuario+negocio, no abre uno nuevo.
   * Requiere que usuario_negocios esté publicado en supabase_realtime con REPLICA IDENTITY FULL.
   */
  iniciarRealtimeMembresia(usuarioId: string, negocioId: string): void {
    const key = `${usuarioId}-${negocioId}`;
    if (this.canalMembresia && this.canalMembresiaKey === key) return;
    if (this.canalMembresia) this.cerrarCanalMembresia();

    try {
      const canal = this.supabase.client
        .channel(`membresia-activa-${key}`)
        .on(
          'postgres_changes' as any,
          {
            event:  'UPDATE',
            schema: 'public',
            table:  'usuario_negocios',
            filter: `usuario_id=eq.${usuarioId}`
          },
          (payload: any) => {
            this.zone.run(async () => {
              const nuevo = payload.new as { negocio_id?: string; activo?: boolean } | null;
              if (!nuevo) return;
              // Solo reaccionar al negocio activo del usuario — ignorar otras membresías
              if (nuevo.negocio_id !== negocioId) return;
              if (nuevo.activo === false) {
                this.logger.warn('AuthService', 'Membresía del usuario desactivada en tiempo real');
                await this.handleUsuarioDesactivado('membresia');
              }
            });
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            this.logger.info('AuthService', 'Realtime membresía suscrito');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            this.logger.error('AuthService', `Realtime membresía falló: ${status}`);
          }
        });

      this.canalMembresia    = canal;
      this.canalMembresiaKey = key;
    } catch (err) {
      this.logger.error('AuthService', 'Error al iniciar Realtime de membresía', err);
      this.canalMembresia    = null;
      this.canalMembresiaKey = null;
    }
  }

  private async cerrarCanalMembresia(): Promise<void> {
    if (!this.canalMembresia) return;
    try {
      await this.supabase.client.removeChannel(this.canalMembresia);
      this.logger.info('AuthService', 'Realtime membresía cerrado');
    } catch (err) {
      this.logger.error('AuthService', 'Error al cerrar canal Realtime membresía', err);
    } finally {
      this.canalMembresia    = null;
      this.canalMembresiaKey = null;
    }
  }

  /**
   * Cierra ambos canales de Realtime (usuario + membresía).
   * Se llama automáticamente via registerBeforeCleanup en handleExpiredSession().
   */
  async cerrarRealtimeUsuario(): Promise<void> {
    await Promise.all([
      this.canalUsuario   ? this.supabase.client.removeChannel(this.canalUsuario).catch(() => {})   : Promise.resolve(),
      this.canalMembresia ? this.supabase.client.removeChannel(this.canalMembresia).catch(() => {}) : Promise.resolve()
    ]);
    this.canalUsuario      = null;
    this.canalUsuarioId    = null;
    this.canalMembresia    = null;
    this.canalMembresiaKey = null;
    this.validadoEnEstaSesion = false;
    this._usuarioActual$.next(null);
    this.logger.info('AuthService', 'Canales Realtime cerrados');
  }

  /**
   * Maneja desactivación via Realtime.
   * NO cierra la sesión OAuth — el usuario puede tocar "Reintentar" si lo reactivan.
   *
   * @param motivo 'usuario' = suspensión global (usuarios.activo=false)
   *               'membresia' = removido del negocio (usuario_negocios.activo=false)
   */
  private async handleUsuarioDesactivado(motivo: 'usuario' | 'membresia' = 'usuario'): Promise<void> {
    this.logger.warn('AuthService', `Procesando desactivación: motivo=${motivo}`);
    this.validadoEnEstaSesion = false;
    await this.cerrarRealtimeUsuario();
    await Preferences.remove({ key: this.USUARIO_KEY }).catch(() => {});
    const msg = motivo === 'membresia'
      ? 'Tu acceso a este negocio fue removido por el administrador.'
      : 'Tu cuenta fue suspendida por el administrador.';
    await this.ui.showToast(msg, 'warning');
    this.router.navigate([ROUTES.auth.pending], { replaceUrl: true, queryParams: { motivo } });
  }

  /** Cierra sesión sin mostrar loading (uso interno) */
  private async forceLogout() {
    await this.supabase.handleExpiredSession();
  }

  /**
   * Cambia el negocio activo desde dentro de la app (usuario ya autenticado).
   * A diferencia de activarNegocio(), no depende de usuarioBase — lee el
   * UsuarioActual desde Preferences directamente.
   * Lee el rol real de la membresía desde BD antes de actualizar el JWT.
   * Actualiza JWT, cache local y navega a /home.
   */
  async cambiarNegocio(negocioId: string, negocioNombre: string): Promise<void> {
    const actual = await this.getUsuarioActual();
    if (!actual) {
      await this.forceLogout();
      return;
    }

    // Superadmin opera con rol ADMIN en cualquier negocio sin necesitar membresía.
    // Para usuarios normales, leer el rol real de usuario_negocios.
    let rolEfectivo: 'ADMIN' | 'EMPLEADO' = 'ADMIN';

    if (!actual.es_superadmin) {
      const { data: membresia, error: membresiaError } = await this.supabase.client
        .from('usuario_negocios')
        .select('rol')
        .eq('usuario_id', actual.id)
        .eq('negocio_id', negocioId)
        .eq('activo', true)
        .maybeSingle();

      if (membresiaError || !membresia) {
        this.logger.error('AuthService', 'Error al leer membresía para cambio de negocio', membresiaError);
        await this.ui.showError('No se pudo cambiar de negocio. Intenta de nuevo.');
        return;
      }

      rolEfectivo = membresia.rol as 'ADMIN' | 'EMPLEADO';
    }

    const { error: rpcError } = await this.supabase.client
      .rpc('fn_set_negocio_activo', { p_negocio_id: negocioId });

    if (rpcError) {
      this.logger.error('AuthService', 'Error en fn_set_negocio_activo', rpcError);
      await this.ui.showError('No se pudo cambiar de negocio. Intenta de nuevo.');
      return;
    }

    const { error: refreshError } = await this.supabase.client.auth.refreshSession();
    if (refreshError) {
      this.logger.error('AuthService', 'Error al refrescar sesión', refreshError);
      await this.ui.showError('Error al actualizar tu sesión.');
      return;
    }

    const actualizado: UsuarioActual = {
      ...actual,
      negocio_id:     negocioId,
      negocio_nombre: negocioNombre,
      rol:            rolEfectivo
    };

    await this.saveUsuarioActual(actualizado);
    this.validadoEnEstaSesion = true;
    this.logger.info('AuthService', `Negocio cambiado a: ${negocioNombre} (${rolEfectivo})`);

    // Hard reload — patron "mini logout interno" (estandar SaaS multi-tenant: Linear, Notion, Slack).
    // El JWT y UsuarioActual ya estan persistidos. Recargar garantiza cero estado del negocio
    // anterior en memoria: BehaviorSubjects, caches de servicios, canales Realtime, paginas de
    // IonicRouteStrategy. Imposible que sobreviva contexto del tenant anterior.
    window.location.href = ROUTES.home;
  }

  /**
   * Navega al panel de superadmin (/admin).
   * Limpia el negocio activo del cache para que el panel opere sin tenant.
   * Solo debe llamarse si el usuario tiene es_superadmin = true.
   */
  async irAlPanelAdmin(): Promise<void> {
    const actual = await this.getUsuarioActual();
    if (!actual?.es_superadmin) return;

    // Limpiar negocio activo del cache — el panel admin opera sin tenant
    const sinNegocio: UsuarioActual = {
      ...actual,
      negocio_id: '',
      negocio_nombre: '',
      rol: 'ADMIN'
    };
    await this.saveUsuarioActual(sinNegocio);

    this.logger.info('AuthService', 'Superadmin → panel admin');
    this.router.navigate([ROUTES.admin], { replaceUrl: true });
  }

  /** Cierra sesión directo, sin confirmación (para pantallas pre-app como pending) */
  async logoutSilent() {
    await this.executeLogout();
  }

  /** Muestra confirmación y cierra sesión si el usuario acepta */
  async logout() {
    const alert = await this.alertCtrl.create({
      header: 'Cerrar Sesión',
      message: '¿Estás seguro de que deseas cerrar sesión?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Cerrar Sesión', role: 'confirm' }
      ]
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role === 'confirm') await this.executeLogout();
  }

  private async executeLogout() {
    this.logger.info('AuthService', 'Logout manual confirmado por el usuario');
    await this.ui.showLoading();
    await this.supabase.handleExpiredSession();
    await this.ui.hideLoading();
  }

  // ==========================================
  // MÉTODOS DE USUARIO ACTUAL (Capacitor Preferences)
  // ==========================================

  /**
   * Obtiene el usuario actual desde Preferences (lectura local, muy rápida).
   * No hace consultas a la BD.
   */
  async getUsuarioActual(): Promise<UsuarioActual | null> {
    try {
      const { value } = await Preferences.get({ key: this.USUARIO_KEY });
      if (!value) return null;
      return JSON.parse(value) as UsuarioActual;
    } catch {
      return null;
    }
  }

  /**
   * Guarda los datos del usuario en Preferences y emite en usuarioActual$.
   * Se llama desde activarNegocio() y desde el handler de Realtime UPDATE.
   */
  private async saveUsuarioActual(usuario: UsuarioActual): Promise<void> {
    await Preferences.set({ key: this.USUARIO_KEY, value: JSON.stringify(usuario) });
    this._usuarioActual$.next(usuario);
  }
}
