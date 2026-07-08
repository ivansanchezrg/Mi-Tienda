import { Injectable, NgZone, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { Preferences } from '@capacitor/preferences';
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

/** Snapshot persistido en Preferences — permite resolver el guard sin red en cold start. */
interface CacheSnapshot {
  negocio_id: string | null;
  cached_at: number; // epoch ms
  data: EstadoSuscripcionResult;
}

/**
 * Estado de la suscripción del negocio activo (monetización SaaS).
 * Ver docs/PLAN-PLANES-SUSCRIPCION.md
 *
 * Estrategia de cache: RAM + Preferences (TTL corto) — igual patrón que ConfigService
 * (stale-while-revalidate). El guard (suscripcionGuard) sirve del snapshot persistido
 * SIN esperar red y dispara una revalidación en background; solo va a BD en el primer
 * arranque tras logout/instalación (sin snapshot todavía).
 *
 * Por qué ahora SÍ vale persistir (a diferencia del criterio original que solo usaba
 * RAM): sin Preferences, `suscripcionGuard` bloqueaba la PRIMERA navegación de cada
 * cold start con un roundtrip de red — justo el guard que corre en el camino más
 * caliente del arranque (después de authGuard, antes de NavigationEnd). El fail-open
 * ante error ya estaba aceptado; servir stale unos segundos hasta que la revalidación
 * en background llegue (o el Realtime de `suscripciones` corrija al instante si hay
 * una suspensión real) es el mismo nivel de riesgo con muchísimo menor costo percibido.
 *
 * Invalidación:
 *  - cambio de negocio (negocio_id distinto al cacheado) → automática
 *  - registrar pago / reactivar (evento explícito) → invalidar()
 *  - logout → Preferences se limpia (registerBeforeCleanup)
 *  - TTL expirado (5 min) → re-consulta a BD en background, pero el guard ya no espera
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
  private readonly STORAGE_KEY = 'mi-tienda:suscripcion-cache:v1';

  /**
   * Tope de espera cuando NO hay snapshot y hay que ir a BD (primer arranque tras
   * login/instalación). Con red mala (WiFi asociado pero sin respuesta) la RPC puede
   * colgar sin timeout, bloqueando la navegación del guard. Pasado el tope se
   * resuelve fail-open (mismo criterio que el catch) y la carga sigue en background
   * para poblar el cache — el próximo arranque ya tendrá snapshot.
   */
  private readonly GUARD_TIMEOUT_MS = 4000;

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
      this.invalidar(); // ya limpia RAM + Preferences
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
   *
   * Cascada por velocidad (mismo patrón que ConfigService):
   *  1. RAM hit (mismo negocio, TTL vivo) → ~0ms
   *  2. Preferences hit (snapshot del mismo negocio, sin importar TTL) → ~5-10ms,
   *     se sirve YA y se dispara una revalidación en background
   *  3. Sin snapshot (logout reciente / primera instalación) → espera la RPC
   *
   * Por qué el snapshot persistido se sirve aunque el TTL haya vencido: el guard
   * necesita una respuesta INMEDIATA para no bloquear la navegación (ver comentario
   * de clase). El TTL solo decide si además hace falta refrescar en background.
   * Nunca lanza: ante error devuelve un estado "no bloqueada" (fail-open) — el guard
   * no debe encerrar al usuario por un fallo de red.
   */
  async getEstado(forzar = false): Promise<EstadoSuscripcionResult> {
    const negocioId = this.getNegocioIdActual();

    const ramValido =
      !forzar &&
      this.cache !== null &&
      this.cacheNegocioId === negocioId &&
      Date.now() - this.cacheAt < this.TTL_MS;

    if (ramValido) return this.cache!;

    if (!forzar) {
      const persistido = await this.leerCachePersistido(negocioId);
      if (persistido) {
        this.cache = persistido;
        this.cacheNegocioId = negocioId;
        this.cacheAt = Date.now();
        this.estado$.next(persistido);
        this.revalidarEnBackground(negocioId);
        return persistido;
      }
    }

    if (!this.loadingPromise) {
      const nueva = this.cargar(negocioId);
      this.loadingPromise = nueva;
      // Limpiar solo si nadie la reemplazó entre medio (invalidar() la anula a null).
      nueva.finally(() => { if (this.loadingPromise === nueva) this.loadingPromise = null; });
    }

    // Sin snapshot no queda otra que esperar la RPC — pero con tope: si la red está
    // "conectada pero rota" (lejos del router), la request puede colgar y este es el
    // único punto que aún bloquearía la navegación. La carga real sigue en background.
    const carga = this.loadingPromise;
    return Promise.race([
      carga,
      new Promise<EstadoSuscripcionResult>(resolve =>
        setTimeout(() => {
          // Solo loguear si la carga sigue colgada de verdad (si ya terminó, el race
          // la eligió a ella y este resolve cae al vacío).
          if (this.loadingPromise === carga) {
            this.logger.warn('SuscripcionService', `getEstado() superó ${this.GUARD_TIMEOUT_MS}ms — fail-open, la carga sigue en background`);
          }
          resolve({ tiene_suscripcion: false, bloqueada: false });
        }, this.GUARD_TIMEOUT_MS)
      ),
    ]);
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
      this.guardarCachePersistido(negocioId, estado);
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

  /** Lectura silenciosa de Preferences. Devuelve null si no hay snapshot o cambió el negocio. */
  private async leerCachePersistido(negocioActual: string | null): Promise<EstadoSuscripcionResult | null> {
    try {
      const { value } = await Preferences.get({ key: this.STORAGE_KEY });
      if (!value) return null;

      const snapshot: CacheSnapshot = JSON.parse(value);
      if (snapshot.negocio_id !== negocioActual) return null;

      return snapshot.data;
    } catch {
      return null;
    }
  }

  private guardarCachePersistido(negocioId: string | null, data: EstadoSuscripcionResult): void {
    const snapshot: CacheSnapshot = { negocio_id: negocioId, cached_at: Date.now(), data };
    Preferences.set({ key: this.STORAGE_KEY, value: JSON.stringify(snapshot) }).catch(() => {});
  }

  /**
   * Revalida contra BD sin bloquear al caller que ya recibió el snapshot persistido.
   * Si detecta que quedó bloqueada, el propio cargar()/estado$ dispara la misma
   * reacción que el Realtime (los componentes suscritos a estado$ reaccionan).
   */
  private revalidarEnBackground(negocioId: string | null): void {
    if (this.loadingPromise) return; // ya hay una carga en curso, no dupliques
    const nueva = this.cargar(negocioId);
    this.loadingPromise = nueva;
    nueva.finally(() => { if (this.loadingPromise === nueva) this.loadingPromise = null; });
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
    Preferences.remove({ key: this.STORAGE_KEY }).catch(() => {});
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
