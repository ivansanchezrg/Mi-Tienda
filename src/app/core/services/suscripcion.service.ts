import { Injectable, NgZone, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { LoggerService } from './logger.service';
import { StorageService } from './storage.service';
import { ROUTES } from '../config/routes.config';
import { AuthService } from '../../features/auth/services/auth.service';
import {
  EstadoSuscripcionResult,
  ConfigPlataforma,
  CuentaBancaria,
  SuscripcionAdmin,
  NegocioPendientePurga,
  Plan,
  MetodoPago,
  SuscripcionPago,
} from '../../features/suscripcion/models/suscripcion.model';

/**
 * Estado de la suscripción del negocio activo (monetización SaaS).
 * Ver docs/PLAN-PLANES-SUSCRIPCION.md
 *
 * Estrategia de cache: RAM + TTL corto (el guard lo consulta en cada navegación;
 * sin cache serían decenas de queries por sesión). Patrón derivado de ConfigService,
 * pero sin Preferences: el estado de cobro debe revalidarse seguido y no vale la pena
 * persistirlo entre cold starts (el guard fail-open cubre el arranque sin red).
 *
 * Invalidación:
 *  - cambio de negocio (negocio_id distinto al cacheado) → automática
 *  - registrar pago / reactivar (evento explícito) → invalidar()
 *  - TTL expirado (5 min) → re-consulta a BD
 */
@Injectable({ providedIn: 'root' })
export class SuscripcionService {
  private supabase = inject(SupabaseService);
  private logger = inject(LoggerService);
  private storage = inject(StorageService);
  private router = inject(Router);
  private zone = inject(NgZone);
  private auth = inject(AuthService);

  /** TTL corto: el estado de cobro cambia (vence, se paga) y el guard lo lee seguido. */
  private readonly TTL_MS = 5 * 60 * 1000;

  private cache: EstadoSuscripcionResult | null = null;
  private cacheNegocioId: string | null = null;
  private cacheAt = 0;
  private loadingPromise: Promise<EstadoSuscripcionResult> | null = null;

  /**
   * Canal de Realtime sobre `suscripciones` del negocio activo. Modelo de estado mutable
   * (refactor 2026-06): hay UNA fila por negocio. El onboarding la crea (INSERT) y cada
   * pago/suspensión/reactivación la ACTUALIZA (UPDATE). Por eso se escucha '*' (ambos).
   * Sin esto, una suspensión del superadmin solo se detecta en la próxima navegación
   * (guard) o tras 5 min de TTL — inaceptable para una acción instantánea.
   */
  private canalSuscripcion: RealtimeChannel | null = null;
  private canalNegocioId: string | null = null;

  /** Emite el estado vigente para que banners/vistas reaccionen sin re-consultar. */
  readonly estado$ = new BehaviorSubject<EstadoSuscripcionResult | null>(null);

  constructor() {
    // Limpiar al cerrar sesión / cambiar de cuenta: evita arrastrar el estado del negocio anterior.
    this.supabase.registerBeforeCleanup(() => {
      this.cerrarRealtimeSuscripcion();
      this.invalidar();
    });

    // El canal de suscripción se ata al usuario activo, NO a la navegación del guard.
    // Así la protección por suspensión/cobro está viva desde el primer render —
    // igual que iniciarRealtimeMembresia en AuthService. Antes solo se abría dentro
    // de getEstado() (guard), y si el usuario quedaba quieto en una página el canal
    // podía no existir y la suspensión del superadmin no llegaba en tiempo real.
    // Suscribirse a usuarioActual$ no genera ciclo de DI: ya inyectamos AuthService.
    this.auth.usuarioActual$.subscribe((usuario) => {
      const negocioId = usuario?.negocio_id ?? null;
      // El superadmin opera dentro de los negocios para soporte y nunca se bloquea;
      // no necesita el canal (mismo criterio de exención que el guard y el handler).
      if (negocioId && !usuario?.es_superadmin) {
        this.iniciarRealtimeSuscripcion(negocioId);
      } else {
        this.cerrarRealtimeSuscripcion();
      }
    });
  }

  /**
   * Estado vigente de la suscripción del negocio activo.
   * Sirve del cache si es del mismo negocio y el TTL no expiró; si no, consulta BD.
   * Nunca lanza: ante error devuelve un estado "no bloqueada" (fail-open) — el guard
   * no debe encerrar al usuario por un fallo de red.
   */
  async getEstado(forzar = false): Promise<EstadoSuscripcionResult> {
    const negocioId = this.getNegocioIdActual();

    const cacheValido =
      !forzar &&
      this.cache !== null &&
      this.cacheNegocioId === negocioId &&
      Date.now() - this.cacheAt < this.TTL_MS;

    if (cacheValido) return this.cache!;

    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = this.cargar(negocioId);
    try {
      return await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  private async cargar(negocioId: string | null): Promise<EstadoSuscripcionResult> {
    // RPC directo (no supabase.call) para controlar el error sin mostrar toast:
    // el guard debe ser silencioso, y el banner global ya avisa si no hay red.
    try {
      const { data, error } = await this.supabase.client.rpc('fn_estado_suscripcion', {
        p_negocio_id: negocioId,
      });
      if (error) throw error;

      // Sin suscripción registrada → tratar como NO bloqueada (negocios previos al sistema).
      const estado: EstadoSuscripcionResult =
        (data as EstadoSuscripcionResult) ?? { tiene_suscripcion: false, bloqueada: false };
      this.cache = estado;
      this.cacheNegocioId = negocioId;
      this.cacheAt = Date.now();
      this.estado$.next(estado);
      // Red de seguridad: normalmente el canal ya lo abrió la suscripción a
      // usuarioActual$ (constructor). Aquí solo cubrimos el caso de que el guard
      // corra antes de que ese stream emita. Idempotente; exime al superadmin.
      if (negocioId && !this.auth.usuarioActualValue?.es_superadmin) {
        this.iniciarRealtimeSuscripcion(negocioId);
      }
      return estado;
    } catch {
      // Fail-open: ante error de red/BD no bloqueamos. El guard deja pasar.
      this.logger.warn('SuscripcionService', 'No se pudo obtener el estado de suscripción (fail-open)');
      return { tiene_suscripcion: false, bloqueada: false };
    }
  }

  /** True si el plan activo incluye la feature indicada. Sin estado conocido → false. */
  tieneFeature(codigo: string): boolean {
    return this.cache?.features?.[codigo] === true;
  }

  /** Datos de cobro globales (WhatsApp + cuentas) para la pantalla de bloqueo. No cachea: se lee al mostrar. */
  async getConfigPlataforma(): Promise<ConfigPlataforma | null> {
    try {
      const { data, error } = await this.supabase.client
        .from('config_plataforma')
        .select('whatsapp_cobro, cuentas_bancarias')
        .eq('id', 1)
        .maybeSingle();
      if (error || !data) return null;
      return {
        whatsapp_cobro:    data.whatsapp_cobro,
        cuentas_bancarias: (data.cuentas_bancarias as CuentaBancaria[]) ?? [],
      };
    } catch {
      return null;
    }
  }

  // ==========================================
  // GESTIÓN DESDE EL SUPERADMIN (/admin)
  // Usan supabase.call (muestran toast en éxito/error) — son acciones explícitas
  // del superadmin, no chequeos silenciosos de fondo como getEstado().
  // ==========================================

  /** Lista todos los negocios con su suscripción vigente (fn_listar_suscripciones_admin). */
  async listarSuscripcionesAdmin(): Promise<SuscripcionAdmin[]> {
    const data = await this.supabase.call<SuscripcionAdmin[]>(
      this.supabase.client.rpc('fn_listar_suscripciones_admin')
    );
    return data ?? [];
  }

  /**
   * Registra UN pago que renueva la suscripción de TODOS los negocios del
   * propietario a la vez (la suscripción se paga por propietario, no por sucursal:
   * PRO = 1 negocio, MAX = N bajo un solo precio). Todos quedan con el mismo plan,
   * periodo y vencimiento. Reemplaza al pago por-negocio en el flujo del panel admin.
   */
  async registrarPagoPropietario(params: {
    propietarioId: string;
    monto: number;
    metodoPagoId: string | null;
    planId?: string | null;
    periodo?: 'MENSUAL' | 'ANUAL' | null;
    nota?: string | null;
  }): Promise<boolean> {
    const res = await this.supabase.call(
      this.supabase.client.rpc('fn_registrar_pago_propietario', {
        p_propietario_id: params.propietarioId,
        p_monto:          params.monto,
        p_metodo_pago_id: params.metodoPagoId,
        p_plan_id:        params.planId ?? null,
        p_periodo:        params.periodo ?? null,
        p_nota:           params.nota ?? null,
      }),
      'Pago registrado. Suscripción renovada.',
      { showLoading: true }
    );
    if (res !== null) this.invalidar();   // alguno de sus negocios podría ser el activo
    return res !== null;
  }

  /**
   * Suspende o reactiva a un propietario por cobro: bloquea / reactiva la
   * suscripción de TODOS sus negocios de una sola acción (la suscripción se paga
   * por propietario, no por sucursal). Cada sucursal muestra la pantalla de cobro.
   */
  async suspenderPropietario(propietarioId: string, suspender: boolean, nota?: string | null): Promise<boolean> {
    const res = await this.supabase.call(
      this.supabase.client.rpc('fn_suspender_propietario_suscripcion', {
        p_propietario_id: propietarioId,
        p_suspender:      suspender,
        p_nota:           nota ?? null,
      }),
      suspender ? 'Propietario suspendido.' : 'Propietario reactivado.',
      { showLoading: true }
    );
    if (res !== null) this.invalidar();
    return res !== null;
  }

  /**
   * Detecta propietarios vencidos hace ≥23 días y los marca para purga
   * (fn_marcar_negocios_para_purga) — solo marca a quienes aún no estaban
   * avisados; quienes ya están en cuenta regresiva no se tocan (no reinicia
   * su plazo). Ver docs/PLAN-BORRADO-AUTOMATICO-NEGOCIOS.md.
   * El superadmin la dispara manualmente desde /admin (no hay cron).
   */
  async marcarNegociosParaPurga(): Promise<NegocioPendientePurga[]> {
    const data = await this.supabase.call<NegocioPendientePurga[]>(
      this.supabase.client.rpc('fn_marcar_negocios_para_purga')
    );
    return data ?? [];
  }

  /** Lista negocios ya marcados para purga (fn_listar_negocios_pendientes_purga). */
  async listarNegociosPendientesPurga(): Promise<NegocioPendientePurga[]> {
    const data = await this.supabase.call<NegocioPendientePurga[]>(
      this.supabase.client.rpc('fn_listar_negocios_pendientes_purga')
    );
    return data ?? [];
  }

  /**
   * Borrado real e irreversible: borra primero la carpeta de Storage del
   * negocio y luego ejecuta fn_purgar_negocio (BD). Si Storage falla, NO
   * continúa con el DELETE en BD — hay un humano mirando que puede reintentar
   * (a diferencia de un futuro cron automático, ver plan sección "Diferido").
   * deleteNegocioFolder lanza si remove() falla — se captura aquí para que el
   * caller reciba `false` en vez de una excepción sin manejar, y pueda avisar
   * al superadmin cuál negocio falló sin interrumpir el resto del lote.
   */
  async purgarNegocio(negocioId: string): Promise<boolean> {
    try {
      await this.storage.deleteNegocioFolder(negocioId);
    } catch (err) {
      this.logger.error('SuscripcionService', `Error al borrar Storage del negocio ${negocioId}`, err);
      return false;
    }

    const res = await this.supabase.call(
      this.supabase.client.rpc('fn_purgar_negocio', { p_negocio_id: negocioId }),
      'Negocio purgado correctamente.',
      { showLoading: true }
    );
    if (res !== null) this.invalidar();
    return res !== null;
  }

  /** Excepción de soporte: cancela la purga programada sin que medie un pago real. */
  async cancelarPurgaNegocio(propietarioId: string): Promise<boolean> {
    const res = await this.supabase.call(
      this.supabase.client.rpc('fn_cancelar_purga_negocio', { p_propietario_id: propietarioId }),
      'Purga cancelada.',
      { showLoading: true }
    );
    if (res !== null) this.invalidar();
    return res !== null;
  }

  /** Catálogo de planes (para el selector al registrar pago y la tab Planes). */
  async listarPlanes(soloActivos = false): Promise<Plan[]> {
    let query = this.supabase.client.from('planes').select('*').order('orden');
    if (soloActivos) query = query.eq('activo', true);
    const data = await this.supabase.call<Plan[]>(query);
    return data ?? [];
  }

  /** Catálogo de métodos de pago activos (para el selector al registrar pago). */
  async listarMetodosPago(soloActivos = true): Promise<MetodoPago[]> {
    let query = this.supabase.client.from('metodos_pago_suscripcion').select('*').order('orden');
    if (soloActivos) query = query.eq('activo', true);
    const data = await this.supabase.call<MetodoPago[]>(query);
    return data ?? [];
  }

  /**
   * Historial de pagos del negocio activo (tabla suscripcion_pagos), paginado.
   * Query directa con joins simples — la tabla es de solo lectura desde el cliente
   * (RLS bloquea INSERT/UPDATE/DELETE; solo fn_registrar_pago_propietario escribe).
   * RLS de SELECT ya filtra por negocio_id = get_negocio_id() (o superadmin).
   */
  async listarPagos(page: number, pageSize: number): Promise<SuscripcionPago[]> {
    const desde = page * pageSize;
    const hasta = desde + pageSize - 1;
    const data = await this.supabase.call<any[]>(
      this.supabase.client
        .from('suscripcion_pagos')
        .select('id, created_at, monto, periodo, vence_el, nota, planes(nombre), metodos_pago_suscripcion(nombre)')
        .order('created_at', { ascending: false })
        .range(desde, hasta)
    );
    return (data ?? []).map(row => ({
      id:                 row.id,
      created_at:         row.created_at,
      monto:              row.monto,
      periodo:            row.periodo,
      vence_el:           row.vence_el,
      nota:               row.nota,
      plan_nombre:        row.planes?.nombre ?? 'Plan',
      metodo_pago_nombre: row.metodos_pago_suscripcion?.nombre ?? null,
    }));
  }

  /** Crea o actualiza un plan (upsert por id). Escritura directa — RLS planes_admin (superadmin). */
  async guardarPlan(plan: Partial<Plan>): Promise<boolean> {
    const esNuevo = !plan.id;
    const query = esNuevo
      ? this.supabase.client.from('planes').insert(plan)
      : this.supabase.client.from('planes').update(plan).eq('id', plan.id!);
    const res = await this.supabase.call(
      query,
      esNuevo ? 'Plan creado.' : 'Plan actualizado.',
      { showLoading: true }
    );
    return res !== null;
  }

  /** Crea o actualiza un método de pago. Escritura directa — RLS metodos_pago_admin (superadmin). */
  async guardarMetodoPago(metodo: Partial<MetodoPago>): Promise<boolean> {
    const esNuevo = !metodo.id;
    const query = esNuevo
      ? this.supabase.client.from('metodos_pago_suscripcion').insert(metodo)
      : this.supabase.client.from('metodos_pago_suscripcion').update(metodo).eq('id', metodo.id!);
    const res = await this.supabase.call(
      query,
      esNuevo ? 'Método creado.' : 'Método actualizado.',
      { showLoading: true }
    );
    return res !== null;
  }

  /** Lee la config de cobro de la plataforma (para la tab Cobro del admin). */
  async getConfigPlataformaAdmin(): Promise<ConfigPlataforma | null> {
    return this.getConfigPlataforma();
  }

  /** Guarda la config de cobro (WhatsApp, cuentas). RLS config_plataforma_admin. */
  async guardarConfigPlataforma(config: ConfigPlataforma): Promise<boolean> {
    const res = await this.supabase.call(
      this.supabase.client.from('config_plataforma').update({
        whatsapp_cobro:    config.whatsapp_cobro,
        cuentas_bancarias: config.cuentas_bancarias,
        updated_at:        new Date().toISOString(),
      }).eq('id', 1),
      'Datos de cobro guardados.',
      { showLoading: true }
    );
    return res !== null;
  }

  /** Limpia el cache. Llamar tras cambiar de negocio o registrar un pago. */
  invalidar(): void {
    this.cache = null;
    this.cacheNegocioId = null;
    this.cacheAt = 0;
    this.loadingPromise = null;
    this.estado$.next(null);
  }

  // ==========================================
  // REALTIME — detectar suspensión/pago al instante (sin esperar TTL ni navegación)
  // ==========================================

  /**
   * Abre un canal de Realtime que escucha cambios en `suscripciones` del negocio activo.
   * Modelo de estado mutable: una fila por negocio que el onboarding crea (INSERT) y los
   * pagos/suspensiones actualizan (UPDATE) — por eso se escucha '*'. Ante cualquier cambio
   * se fuerza una relectura con fn_estado_suscripcion (no se confía en el payload crudo) y,
   * si quedó bloqueada, se redirige a la pantalla de cobro — igual de instantáneo que el
   * Realtime de membresía (`iniciarRealtimeMembresia`).
   *
   * Es idempotente: si ya hay un canal abierto para el mismo negocio, no hace nada.
   */
  private iniciarRealtimeSuscripcion(negocioId: string): void {
    if (this.canalSuscripcion && this.canalNegocioId === negocioId) return;
    if (this.canalSuscripcion) this.cerrarRealtimeSuscripcion();

    try {
      const canal = this.supabase.client
        .channel(`suscripcion-negocio-${negocioId}`)
        .on(
          'postgres_changes' as any,
          { event: '*', schema: 'public', table: 'suscripciones', filter: `negocio_id=eq.${negocioId}` },
          (payload: any) => {
            this.zone.run(async () => {
              const fila = payload.new as { estado?: string } | null;
              if (!fila) return;

              this.logger.info('SuscripcionService', `Suscripción cambió en tiempo real: ${fila.estado}`);

              // Estado ANTES de releer: distingue una transición real bloqueo→desbloqueo
              // de un simple cambio de plan estando ya vigente (en modo "Mi Plan" el
              // usuario está en /suscripcion legítimamente y no hay que sacarlo).
              const estabaBloqueada = this.cache?.bloqueada === true;

              // Forzar relectura (no confiar en el payload crudo: fn_estado_suscripcion
              // también deriva VENCIDA/bloqueada con la misma lógica que usa el guard).
              const estado = await this.getEstado(true);

              // El superadmin nunca se bloquea ni se redirige (opera dentro del
              // negocio para soporte), igual exención que suscripcionGuard.
              if (this.auth.usuarioActualValue?.es_superadmin) return;

              const enPantallaSuscripcion = this.router.url.startsWith(ROUTES.suscripcion.root);

              if (estado.bloqueada) {
                // Quedó bloqueada (suspensión / vencimiento) → a la pantalla de cobro,
                // salvo que ya esté ahí (evita una navegación redundante).
                if (!enPantallaSuscripcion) {
                  this.router.navigate([ROUTES.suscripcion.root], { replaceUrl: true });
                }
              } else if (estabaBloqueada && enPantallaSuscripcion) {
                // Transición bloqueo→vigente (pago / reactivación) y el usuario sigue
                // varado en la pantalla de cobro → devolverlo a la app. Solo redirige
                // si VENÍA bloqueado y está EN /suscripcion; si entró voluntariamente a
                // "Mi Plan" o está operando en otra página, no lo movemos.
                this.router.navigate([ROUTES.home], { replaceUrl: true });
              }
            });
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            this.logger.info('SuscripcionService', 'Realtime suscripción suscrito');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            this.logger.error('SuscripcionService', `Realtime suscripción falló: ${status}`);
          }
        });

      this.canalSuscripcion = canal;
      this.canalNegocioId = negocioId;
    } catch (err) {
      this.logger.error('SuscripcionService', 'Error al iniciar Realtime de suscripción', err);
      this.canalSuscripcion = null;
      this.canalNegocioId = null;
    }
  }

  private cerrarRealtimeSuscripcion(): void {
    if (this.canalSuscripcion) {
      this.supabase.client.removeChannel(this.canalSuscripcion);
      this.canalSuscripcion = null;
      this.canalNegocioId = null;
    }
  }

  /** negocio_id del JWT (mismo mecanismo que ConfigService). */
  private getNegocioIdActual(): string | null {
    try {
      const token = (this.supabase.client.auth as any).currentSession?.access_token;
      if (!token) return null;
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload?.app_metadata?.negocio_id ?? null;
    } catch {
      return null;
    }
  }
}
