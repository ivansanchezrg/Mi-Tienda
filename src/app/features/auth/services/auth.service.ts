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
import { UsuarioActual } from '../models/usuario_actual.model';
import { ROUTES } from '@core/config/routes.config';

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
   * Canal de Realtime del usuario actual.
   * Abierto tras validarUsuario() exitoso, cerrado en handleExpiredSession()
   * via el hook registerBeforeCleanup. Solo debe existir un canal activo a la vez.
   */
  private canalUsuario: RealtimeChannel | null = null;

  /** ID del usuario cuyo canal está actualmente abierto. Usado para idempotencia. */
  private canalUsuarioId: number | null = null;

  /**
   * Observable reactivo del usuario actual.
   * Emite cada vez que el usuario cambia (login, cambio de rol via Realtime, logout).
   * El sidebar se suscribe para actualizar rol, menú y UI sin refrescar.
   */
  private readonly _usuarioActual$ = new BehaviorSubject<UsuarioActual | null>(null);
  readonly usuarioActual$ = this._usuarioActual$.asObservable();

  /**
   * Flag que indica si validarUsuario() ya se ejecutó exitosamente en esta sesión.
   * Se resetea a false en handleExpiredSession() (via cleanup) y handleUsuarioDesactivado().
   *
   * Permite que authGuard llame validarUsuario() en la primera navegación (para detectar
   * desactivaciones que ocurrieron mientras la app estaba cerrada) y use cache + Realtime
   * en las navegaciones siguientes (sin query HTTP adicional).
   */
  private validadoEnEstaSesion = false;

  constructor() {
    const projectRef = environment.supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || '';
    this.STORAGE_KEY = `sb-${projectRef}-auth-token`;

    // Registrar cleanup del canal de Realtime ante cualquier expiración/logout.
    // Esto evita websockets huérfanos cuando la sesión se cierra por cualquier vía.
    this.supabase.registerBeforeCleanup(() => this.cerrarRealtimeUsuario());
  }

  /**
   * Verifica si el usuario ya fue validado contra la BD en esta sesión.
   * Usado por authGuard para evitar consultas HTTP en cada navegación:
   * - Primera navegación: validarUsuario() (consulta BD, inicia Realtime)
   * - Navegaciones siguientes: cache + Realtime (cero queries adicionales)
   */
  get yaValidadoEnEstaSesion(): boolean {
    return this.validadoEnEstaSesion;
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

  /**
   * Valida que el email del usuario logueado exista en la tabla usuarios y esté activo.
   * - Si no existe → auto-registra con activo: false y redirige a /auth/pending.
   * - Si existe pero activo: false → redirige a /auth/pending.
   * - Si existe y activo: true → guarda en Preferences y retorna true.
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
      .select('id, nombre, usuario, activo, rol, es_superadmin')
      .eq('usuario', user.email)
      .maybeSingle();

    if (error) {
      this.logger.error('AuthService', 'Error al consultar usuario en BD', error);
      await this.ui.showError('Error al verificar tu cuenta. Intentá de nuevo.');
      await this.forceLogout();
      return false;
    }

    // Usuario no existe → auto-registro con activo: false
    if (!data) {
      this.logger.info('AuthService', 'Auto-registro de nuevo usuario');
      const nombre = user.user_metadata?.['full_name'] || user.user_metadata?.['name'] || user.email.split('@')[0];

      const { error: insertError } = await this.supabase.client
        .from('usuarios')
        .insert({ nombre, usuario: user.email, rol: 'EMPLEADO', activo: false });

      if (insertError) {
        this.logger.error('AuthService', 'Error al auto-registrar usuario', insertError);
        await this.ui.showError('Error al registrar tu cuenta. Intentá de nuevo.');
        await this.forceLogout();
        return false;
      }

      this.router.navigate([ROUTES.auth.pending], { queryParams: { estado: 'nuevo' }, replaceUrl: true });
      return false;
    }

    // Usuario existe pero inactivo → pantalla de pendiente
    if (!data.activo) {
      this.logger.warn('AuthService', 'validarUsuario: cuenta inactiva');
      await this.saveUsuarioActual(data);
      this.router.navigate([ROUTES.auth.pending], { replaceUrl: true });
      return false;
    }

    this.logger.info('AuthService', `Usuario validado (rol: ${data.rol})`);
    await this.saveUsuarioActual(data);
    this.iniciarRealtimeUsuario(data.id);
    this.validadoEnEstaSesion = true;
    return true;
  }

  // ==========================================
  // REALTIME — Monitorear cambios en el usuario actual
  // ==========================================

  /**
   * Abre un canal de Realtime que escucha cambios en el registro del usuario
   * actual en la tabla `usuarios`. Si el admin desactiva o elimina al usuario
   * mientras está logueado, la app reacciona en segundos en lugar de esperar
   * al próximo login.
   *
   * Comportamiento:
   * - UPDATE con activo=false → handleUsuarioDesactivado() → redirige a /auth/pending
   *   (NO cierra sesión de Supabase: el usuario puede tocar "Reintentar" si lo reactivan)
   * - DELETE → handleExpiredSession() → redirige a /auth/login
   *   (sí cierra sesión completa porque ya no hay usuario que validar)
   *
   * Es idempotente: si ya hay un canal abierto para el mismo usuario, no hace
   * nada. Si hay un canal para otro usuario (cambio de cuenta), lo cierra primero.
   *
   * Requiere que la política RLS de la tabla usuarios permita SELECT al propio
   * registro (ver docs/auth/sql/setup/realtime_usuarios.sql).
   */
  iniciarRealtimeUsuario(id: number): void {
    // Idempotencia: mismo usuario, canal ya abierto → nada que hacer
    if (this.canalUsuario && this.canalUsuarioId === id) {
      return;
    }

    // Cambio de usuario: cerrar canal anterior antes de abrir el nuevo
    if (this.canalUsuario) {
      this.cerrarRealtimeUsuario();
    }

    try {
      const canal = this.supabase.client
        .channel(`usuario-activo-${id}`)
        .on(
          'postgres_changes' as any,
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'usuarios',
            filter: `id=eq.${id}`
          },
          (payload: any) => {
            // Los eventos de Realtime llegan fuera del zone de Angular.
            // Sin NgZone.run(), la UI no se actualiza hasta el próximo tick.
            this.zone.run(async () => {
              const nuevo = payload.new as Partial<UsuarioActual> | null;
              if (!nuevo) return;

              // Caso 1: usuario desactivado → sacar de la app
              if (nuevo.activo === false) {
                this.logger.warn('AuthService', 'Usuario desactivado en tiempo real');
                await this.handleUsuarioDesactivado();
                return;
              }

              // Caso 2: cualquier otro cambio (rol, nombre, etc.) → actualizar cache y UI
              this.logger.info('AuthService', 'Datos del usuario actualizados en tiempo real');
              const usuarioActualizado: UsuarioActual = {
                id: nuevo.id ?? id,
                nombre: nuevo.nombre ?? '',
                usuario: nuevo.usuario ?? '',
                activo: nuevo.activo ?? true,
                rol: nuevo.rol ?? 'EMPLEADO',
                es_superadmin: (nuevo as any).es_superadmin ?? false
              };
              await this.saveUsuarioActual(usuarioActualizado);
            });
          }
        )
        .on(
          'postgres_changes' as any,
          {
            event: 'DELETE',
            schema: 'public',
            table: 'usuarios',
            filter: `id=eq.${id}`
          },
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
      // No bloquear el flujo de login si Realtime falla — las otras capas
      // de protección (JWT, SIGNED_OUT, call()) siguen activas como red de seguridad.
      this.logger.error('AuthService', 'Error al iniciar Realtime del usuario', err);
      this.canalUsuario = null;
      this.canalUsuarioId = null;
    }
  }

  /**
   * Cierra el canal de Realtime del usuario actual (si existe).
   * Se llama automáticamente desde el hook registerBeforeCleanup cada vez
   * que handleExpiredSession() limpia la sesión — garantiza que no queden
   * websockets huérfanos sin importar la causa del logout.
   */
  async cerrarRealtimeUsuario(): Promise<void> {
    if (!this.canalUsuario) return;

    try {
      await this.supabase.client.removeChannel(this.canalUsuario);
      this.logger.info('AuthService', 'Realtime usuario cerrado');
    } catch (err) {
      this.logger.error('AuthService', 'Error al cerrar canal Realtime', err);
    } finally {
      this.canalUsuario = null;
      this.canalUsuarioId = null;
      this.validadoEnEstaSesion = false;
      this._usuarioActual$.next(null);
    }
  }

  /**
   * Maneja el caso específico de usuario desactivado via Realtime (UPDATE activo=false).
   *
   * A diferencia de handleExpiredSession() (que cierra la sesión de Supabase completa),
   * este método CONSERVA la sesión OAuth porque:
   * - El registro del usuario sigue existiendo en BD (solo fue desactivado)
   * - En /auth/pending, el botón "Reintentar" llama validarUsuario() que necesita
   *   una sesión activa para consultar la tabla usuarios
   * - Si el admin reactiva la cuenta, el usuario puede reingresar sin hacer OAuth de nuevo
   *
   * Lo que sí limpia:
   * - Canal de Realtime (ya no tiene sentido escuchar más cambios)
   * - Cache de usuario en Preferences (el cache dice activo=true, ya no es válido)
   */
  private async handleUsuarioDesactivado(): Promise<void> {
    this.logger.warn('AuthService', 'Procesando desactivación de usuario');

    // Resetear flag de validación (la próxima apertura debe re-validar contra BD)
    this.validadoEnEstaSesion = false;

    // Cerrar canal de Realtime (evitar escuchar más eventos con un usuario ya inactivo)
    await this.cerrarRealtimeUsuario();

    // Limpiar cache del usuario (ya no es válido con activo=true)
    await Preferences.remove({ key: this.USUARIO_KEY }).catch(() => {});

    // Notificar al usuario y redirigir
    await this.ui.showToast('Tu cuenta fue desactivada por un administrador', 'warning');
    this.router.navigate([ROUTES.auth.pending], { replaceUrl: true });
  }

  /** Cierra sesión sin mostrar loading (uso interno) */
  private async forceLogout() {
    await this.supabase.handleExpiredSession();
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

    if (role === 'confirm') {
      await this.executeLogout();
    }
  }

  /** Ejecuta el cierre de sesión */
  private async executeLogout() {
    this.logger.info('AuthService', 'Logout manual confirmado por el usuario');
    await this.ui.showLoading();
    await this.supabase.handleExpiredSession();
    await this.ui.hideLoading();
  }

  // ==========================================
  // MÉTODOS DE USUARIO ACTUAL (Preferences)
  // ==========================================

  /**
   * Obtiene el usuario actual desde Preferences (lectura local, muy rápida).
   * No hace consultas a la BD.
   * Retorna null si no hay usuario guardado.
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
   * Guarda los datos del usuario en Preferences.
   * Se llama automáticamente después de validar el login.
   */
  private async saveUsuarioActual(usuario: UsuarioActual): Promise<void> {
    await Preferences.set({
      key: this.USUARIO_KEY,
      value: JSON.stringify(usuario)
    });
    this._usuarioActual$.next(usuario);
  }

}
