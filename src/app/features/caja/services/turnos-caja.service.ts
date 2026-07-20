import { Injectable, inject, NgZone } from '@angular/core';
import { BehaviorSubject, map, distinctUntilChanged, combineLatest, filter, firstValueFrom } from 'rxjs';
import { Preferences } from '@capacitor/preferences';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '@core/services/supabase.service';
import { LoggerService } from '@core/services/logger.service';
import { ConfigService } from '@core/services/config.service';
import { TurnoLocalService } from '@core/services/turno-local.service';
import { NetworkService } from '@core/services/network.service';
import { SyncService } from '@core/services/sync.service';
import { AuthService } from '../../auth/services/auth.service';
import { TurnoCaja, TurnoCajaConEmpleado, EstadoCaja, EstadoCajaTipo } from '../models/turno-caja.model';
import { Caja } from './cajas.service';
import { DatosCierreDiario } from '../models/saldos-anteriores.model';
import { getFechaLocal, getInicioDiaSiguienteDeISO } from '@core/utils/date.util';
import { TIMING } from '@core/config/timing.config';
import { TimeoutError } from '@core/utils/timeout.util';

/**
 * Snapshot consolidado del dashboard del home (devuelto por la RPC fn_home_dashboard).
 * Reemplaza las múltiples llamadas paralelas que hacía home.cargarDatos().
 * v1.3: incluye cajas[] para que cargarDatos() sea la única fuente de verdad del Home.
 * v1.4: incluye modulos con flags de visibilidad con fuente de verdad correcta por caja:
 *   - variosActiva:        cajas.activo en BD (reversible via fn_configurar_caja_varios)
 *   - celularHabilitada:   flag en configuraciones (puede existir en BD pero desactivada)
 *   - busHabilitada:       flag en configuraciones (igual que celular)
 * v2.0 (2026-07-03): se eliminó la sección "últimos 5 movimientos" del home. La RPC
 *   ya no devuelve la lista ni el count — solo los agregados ingresos/egresos del día
 *   completo, que alimentan los deltas del hero (antes se calculaban sumando únicamente
 *   los últimos 5 movimientos: ahora son correctos además de más baratos).
 */
export interface HomeDashboard {
  estadoCaja: EstadoCaja;
  saldoVirtualCelular: number;
  saldoVirtualBus: number;
  ingresosHoy: number;
  egresosHoy: number;
  cajas: Caja[];
  modulos: {
    variosActiva: boolean;
    celularHabilitada: boolean;
    busHabilitada: boolean;
  };
}

/**
 * Snapshot del dashboard persistido en Preferences — habilita el arranque instantáneo
 * del home (stale-while-revalidate). Válido solo el mismo día local y el mismo negocio:
 * los turnos son diarios, pintar un "turno abierto" de ayer confunde más de lo que ayuda.
 */
interface HomeDashboardSnapshot {
  negocio_id: string | null;
  fecha: string;            // 'YYYY-MM-DD' local (getFechaLocal)
  data: HomeDashboard;
}

/**
 * Instrucción de feedback que el caller (modal / página) debe aplicar en un fallo
 * de mutación de turno. Centraliza la decisión "qué mostrar" en el servicio para que
 * el caller no re-derive el tipo de error:
 *  - 'silenciar' → sin red y el banner global ya avisa; no mostrar nada.
 *  - 'red'       → red "conectada pero rota" (timeout); mostrar overlay de conexión.
 *  - 'mensaje'   → error de negocio con texto propio en `errorMsg`; mostrarlo tal cual.
 */
type TurnoFeedback = 'silenciar' | 'red' | 'mensaje';

export interface TurnoMutacionResult {
  ok: boolean;
  turnoId?: string;
  /** Presente solo cuando ok === false. */
  feedback?: TurnoFeedback;
  /** Texto del error de negocio (solo con feedback === 'mensaje'). */
  errorMsg?: string;
}

@Injectable({
  providedIn: 'root'
})
export class TurnosCajaService {
  private supabase = inject(SupabaseService);
  private authService = inject(AuthService);
  private logger = inject(LoggerService);
  private configService = inject(ConfigService);
  private zone = inject(NgZone);
  private turnoLocal = inject(TurnoLocalService);
  private network = inject(NetworkService);
  private syncService = inject(SyncService);

  // ==========================================
  // ESTADO REACTIVO — turno activo + caja abierta
  // ==========================================

  /**
   * Turno actualmente abierto (hora_fecha_cierre IS NULL), o null si no hay.
   * Fuente unica de verdad del estado del turno — todos los consumidores
   * (POS, Cajon, Sidebar, HomePage, layout) se suscriben aqui.
   *
   * Se carga una vez tras validarUsuario() exitoso (desde AuthService) y se
   * mantiene sincronizado via Realtime de la tabla turnos_caja.
   */
  private readonly _turnoActivo$ = new BehaviorSubject<TurnoCajaConEmpleado | null>(null);
  readonly turnoActivo$ = this._turnoActivo$.asObservable();

  /**
   * Derivado: true si el turno activo fue abierto por el usuario actual.
   * Solo el empleado que abrió el turno puede operar el Cajón y el POS.
   * Los demás usuarios pueden ver el estado pero no registrar en esas secciones.
   */
  readonly esMiTurno$ = combineLatest([
    this._turnoActivo$,
    this.authService.usuarioActual$
  ]).pipe(
    map(([turno, usuario]) => turno !== null && !!usuario && turno.empleado_id === usuario.id),
    distinctUntilChanged()
  );

  /**
   * Emite true una vez que inicializarEstadoReactivo() termino su query a BD.
   * El guard cajaAbiertaGuard espera este flag antes de decidir — evita la
   * race condition al hacer refresh (el estado reactivo aun no cargo).
   */
  private readonly _inicializado$ = new BehaviorSubject<boolean>(false);

  /** Canal de Realtime que escucha cambios en turnos_caja. Uno solo a la vez. */
  private canalTurnos: RealtimeChannel | null = null;

  constructor() {
    // 1. Auto-inicializar cuando AuthService emita un usuario valido.
    //    Esto evita una dependencia circular explicita: AuthService no necesita
    //    llamar a TurnosCajaService — este se engancha al observable del usuario.
    //    AuthService emite en usuarioActual$ tras validarUsuario() exitoso.
    this.authService.usuarioActual$.subscribe(usuario => {
      if (usuario) {
        this.inicializarEstadoReactivo();
      } else {
        // logout / sesion expirada → reset defensivo.
        // _inicializado$ vuelve a false para que el guard espere correctamente
        // si el usuario vuelve a iniciar sesion en la misma sesion de app.
        this._turnoActivo$.next(null);
        this._inicializado$.next(false);
      }
    });

    // 2. Cerrar canal cuando se limpia la sesion via handleExpiredSession().
    //    SupabaseService expone registerBeforeCleanup como array — no pisa el
    //    listener que ya tiene registrado AuthService.
    this.supabase.registerBeforeCleanup(() => this.cerrarRealtimeTurnos());

    // 3. Borrar el snapshot del home en logout — un usuario que cambia de cuenta
    //    no debe ver datos del negocio anterior en el primer render del proximo
    //    cold start (mismo patron que ConfigService).
    this.supabase.registerBeforeCleanup(() =>
      Preferences.remove({ key: TurnosCajaService.HOME_DASHBOARD_CACHE_KEY }).catch(() => {})
    );

    // 4. Migracion: borrar el snapshot v1 huerfano (shape viejo con movimientos).
    //    Best-effort — se puede quitar esta linea en una version futura.
    Preferences.remove({ key: 'mi-tienda:home-dashboard-cache:v1' }).catch(() => {});
  }

  /** Valor sincronico del turno activo (util en codigo imperativo). */
  get turnoActivoValue(): TurnoCajaConEmpleado | null {
    return this._turnoActivo$.value;
  }

  /** Valor sincronico: true si el turno activo pertenece al usuario actual. */
  get esMiTurnoValue(): boolean {
    const turno = this._turnoActivo$.value;
    const usuario = this.authService.usuarioActualValue;
    return turno !== null && !!usuario && turno.empleado_id === usuario.id;
  }

  /**
   * Carga inicial del turno activo + apertura del canal de Realtime.
   * Se llama desde AuthService tras validarUsuario() exitoso, para que el
   * estado reactivo este listo antes de que cualquier pagina se suscriba.
   *
   * Idempotente: si ya hay un canal abierto, solo refresca el valor actual.
   */
  async inicializarEstadoReactivo(): Promise<void> {
    try {
      // 1. LOCAL-FIRST (2026-07-08): hidratar del snapshot local ANTES de tocar la red.
      //    Cubre el caso "red presente pero mala" (lejos del router, WiFi intermitente):
      //    isConnected() reporta true pero la query puede tardar 5-30s. Sin esto,
      //    esMiTurno quedaba false todo ese tiempo → botón del turno roto y POS
      //    bloqueado aunque el turno del usuario siga abierto. Con el turno local
      //    emitido, el usuario puede vender de inmediato; la BD reconcilia después.
      if (!this._turnoActivo$.value) {
        const local = await this.reconstruirTurnoDesdeSnapshot();
        if (local) {
          this._turnoActivo$.next(local);
          // El cajaAbiertaGuard ya puede dejar entrar al POS sin esperar la BD.
          this._inicializado$.next(true);
        }
      }

      // 2. Reconciliar con el servidor. consultarTurnoActivoServidor() distingue
      //    "respuesta real" de "fallo" — SOLO una respuesta 200 del servidor pisa el
      //    estado local. Antes la distinción era isConnected(), que miente con red
      //    mala: un fallo de transporte con isConnected()=true entraba a la rama
      //    "online", pisaba turnoActivo$ con null y BORRABA el snapshot local del
      //    turno — destruyendo el cobro offline justo cuando más se necesita.
      const resultado = await this.consultarTurnoActivoServidor();

      if (resultado.ok) {
        this._turnoActivo$.next(resultado.turno);
        await this.sincronizarSnapshotLocal(resultado.turno);
      } else if (!this._turnoActivo$.value) {
        // La query no obtuvo respuesta confiable (offline real, red rota, JWT en
        // renovación fallida). Fallback: snapshot local si el paso 1 no lo cargó
        // (p. ej. arranque offline donde el usuario del snapshot aún no coincidía).
        const local = await this.reconstruirTurnoDesdeSnapshot();
        this._turnoActivo$.next(local);
      }
      // resultado.ok === false CON turno local ya emitido → no tocar nada:
      // el estado local vigente es la mejor información disponible.
    } catch (err) {
      // Sin red la query del turno falla; no es fatal. El estado se reconcilia
      // cuando vuelve la conexión (home llama de nuevo a inicializarEstadoReactivo).
      this.logger.error('TurnosCajaService', 'Error al inicializar estado reactivo', err);
    } finally {
      // El canal Realtime se abre SIEMPRE, aunque la query haya fallado: es
      // idempotente y no depende del resultado del turno. Así, cuando la red
      // vuelve, los cambios de turnos_caja se propagan sin esperar otra llamada.
      this.abrirRealtimeTurnos();
      this._inicializado$.next(true);
    }
  }

  /**
   * Consulta el turno activo distinguiendo "respuesta real del servidor" (ok: true,
   * turno puede ser null = no hay turno) de "fallo" (ok: false = transporte, JWT,
   * RLS — cualquier cosa que NO sea una lectura confiable). Los callers usan esa
   * distinción para decidir si es seguro pisar el estado local: `null` de un fallo
   * NO significa "no hay turno".
   *
   * No usa supabase.call() a propósito: call() silencia el error de transporte y
   * devuelve null, indistinguible de "no hay turno". Sí espera resumeRefreshInFlight
   * (mismo contrato que call()) para no salir con un token vencido.
   */
  private async consultarTurnoActivoServidor(): Promise<{ ok: true; turno: TurnoCajaConEmpleado | null } | { ok: false }> {
    try {
      if (this.supabase.resumeRefreshInFlight) {
        await this.supabase.resumeRefreshInFlight;
      }
      const { data, error } = await this.supabase.client
        .from('turnos_caja')
        .select('*, empleado:usuarios(id, nombre)')
        .is('hora_fecha_cierre', null)
        .maybeSingle();

      if (error) {
        this.logger.warn('TurnosCajaService', `Query del turno sin respuesta confiable: ${error.message}`);
        return { ok: false };
      }
      return { ok: true, turno: data as TurnoCajaConEmpleado | null };
    } catch (err: any) {
      this.logger.warn('TurnosCajaService', `Query del turno falló por transporte: ${err?.message ?? err}`);
      return { ok: false };
    }
  }

  /**
   * Reconstruye un TurnoCajaConEmpleado mínimo desde el snapshot local (offline).
   * El nombre del empleado sale del usuario actual: el snapshot solo se puede haber
   * escrito para el turno del propio usuario, así que es el mismo empleado. Devuelve
   * null si no hay snapshot o si el empleado del snapshot no es el usuario actual
   * (defensa: nunca habilitar el POS de otro empleado offline).
   */
  private async reconstruirTurnoDesdeSnapshot(): Promise<TurnoCajaConEmpleado | null> {
    const snapshot = await this.turnoLocal.obtener();
    const usuario = this.authService.usuarioActualValue;
    if (!snapshot || !usuario || snapshot.empleadoId !== usuario.id) return null;

    return {
      id:                  snapshot.turnoId,
      numero_turno:        snapshot.numeroTurno,
      empleado_id:         snapshot.empleadoId,
      hora_fecha_apertura: new Date(snapshot.abiertoAt).toISOString(),
      hora_fecha_cierre:   null,
      fondo_apertura:      0, // no se persiste en el snapshot; irrelevante para esMiTurno/POS
      empleado:            { id: usuario.id, nombre: usuario.nombre },
    };
  }

  /**
   * Resuelve cuando el estado de BD ya cargo (inicializarEstadoReactivo termino).
   * Usar en guards que necesitan saber si hay turno ANTES de decidir la navegacion.
   * Si ya estaba inicializado, resuelve inmediatamente sin query extra.
   */
  async esperarEstadoListo(): Promise<void> {
    if (this._inicializado$.value) return;
    await firstValueFrom(this._inicializado$.pipe(filter(v => v)));
  }

  /**
   * Abre el canal de Realtime que escucha cambios en turnos_caja.
   * Propaga automaticamente apertura (INSERT), cierre (UPDATE con
   * hora_fecha_cierre IS NOT NULL) y eliminacion (DELETE) al BehaviorSubject.
   *
   * Requiere que la tabla este publicada en Realtime con REPLICA IDENTITY FULL
   * y RLS que permita SELECT a authenticated (ver
   * docs/dashboard/sql/setup/realtime_turnos_caja.sql).
   */
  private abrirRealtimeTurnos(): void {
    if (this.canalTurnos) return; // idempotente

    try {
      const canal = this.supabase.client
        .channel('turnos-caja-activo')
        .on(
          'postgres_changes' as any,
          { event: '*', schema: 'public', table: 'turnos_caja' },
          (payload: any) => {
            this.zone.run(() => this.handleTurnoChange(payload));
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            this.logger.info('TurnosCajaService', 'Realtime turnos suscrito');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            this.logger.error('TurnosCajaService', `Realtime turnos fallo: ${status}`);
          }
        });

      this.canalTurnos = canal;
    } catch (err) {
      this.logger.error('TurnosCajaService', 'Error al abrir Realtime turnos', err);
      this.canalTurnos = null;
    }
  }

  /**
   * Procesa eventos de Realtime de turnos_caja y actualiza turnoActivo$.
   *
   * Reglas:
   * - INSERT con hora_fecha_cierre IS NULL → nuevo turno abierto → refetch
   *   (necesitamos el JOIN con empleado que el payload no trae)
   * - UPDATE: si cambio hora_fecha_cierre de null → not null, cerro el turno
   *   → turnoActivo = null
   * - DELETE del turno activo actual → turnoActivo = null
   *
   * Para INSERT hacemos refetch en lugar de construir el objeto del payload
   * porque TurnoCajaConEmpleado incluye el JOIN usuarios(nombre) que Realtime
   * no entrega. Es una query extra pero solo corre al abrir turno (infrecuente).
   */
  private async handleTurnoChange(payload: any): Promise<void> {
    const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
    const nuevo = payload.new as TurnoCaja | null;
    const viejo = payload.old as TurnoCaja | null;
    const actual = this._turnoActivo$.value;

    if (eventType === 'INSERT') {
      // Solo refetch si el INSERT es de un turno abierto
      if (nuevo && !nuevo.hora_fecha_cierre) {
        const turno = await this.obtenerTurnoActivo();
        this._turnoActivo$.next(turno);
        await this.sincronizarSnapshotLocal(turno);
        this.logger.info('TurnosCajaService', 'Turno abierto detectado en tiempo real');
      }
      return;
    }

    if (eventType === 'UPDATE') {
      // Si el turno que estaba activo se cerro, bajar el estado a null
      if (actual && nuevo && nuevo.id === actual.id && nuevo.hora_fecha_cierre) {
        this._turnoActivo$.next(null);
        await this.sincronizarSnapshotLocal(null);
        this.logger.info('TurnosCajaService', 'Turno cerrado detectado en tiempo real');
        return;
      }
      // Caso borde: un turno se reabrio (no deberia pasar, pero protegemos)
      if (!actual && nuevo && !nuevo.hora_fecha_cierre) {
        const turno = await this.obtenerTurnoActivo();
        this._turnoActivo$.next(turno);
        await this.sincronizarSnapshotLocal(turno);
      }
      return;
    }

    if (eventType === 'DELETE') {
      if (actual && viejo && viejo.id === actual.id) {
        this._turnoActivo$.next(null);
        await this.sincronizarSnapshotLocal(null);
        this.logger.warn('TurnosCajaService', 'Turno eliminado en tiempo real');
      }
    }
  }

  /**
   * Reabre el canal de Realtime de turnos con una conexión limpia, SIN resetear
   * turnoActivo$ (a diferencia de cerrarRealtimeTurnos, que es para logout).
   *
   * Necesario tras recuperar la red en un arranque offline: el canal que se intentó
   * abrir sin conexión puede haber quedado en estado CHANNEL_ERROR y no reconectar
   * solo. Lo cerramos y reabrimos para garantizar que los cambios de turnos_caja
   * vuelvan a propagarse.
   */
  async reabrirRealtimeTurnos(): Promise<void> {
    if (this.canalTurnos) {
      try {
        await this.supabase.client.removeChannel(this.canalTurnos);
      } catch (err) {
        this.logger.error('TurnosCajaService', 'Error al cerrar canal Realtime turnos (reabrir)', err);
      } finally {
        this.canalTurnos = null;
      }
    }
    this.abrirRealtimeTurnos();
  }

  /**
   * Cierra el canal de Realtime y resetea el estado.
   * Se llama automaticamente via registerBeforeCleanup cuando la sesion
   * se limpia (logout, JWT expirado, etc.).
   */
  private async cerrarRealtimeTurnos(): Promise<void> {
    if (this.canalTurnos) {
      try {
        await this.supabase.client.removeChannel(this.canalTurnos);
        this.logger.info('TurnosCajaService', 'Realtime turnos cerrado');
      } catch (err) {
        this.logger.error('TurnosCajaService', 'Error al cerrar canal Realtime turnos', err);
      } finally {
        this.canalTurnos = null;
      }
    }
    this._turnoActivo$.next(null);
  }

  /**
   * Refresca manualmente el turno activo desde la BD y emite el valor.
   * Util despues de abrirTurno() cuando queremos garantizar el estado
   * antes de que Realtime notifique (evita flash de UI).
   */
  async refrescarTurnoActivo(): Promise<void> {
    const turno = await this.obtenerTurnoActivo();
    this._turnoActivo$.next(turno);
    await this.sincronizarSnapshotLocal(turno);
  }

  /**
   * Sincroniza turnoActivo$ con el estado que reporta el servidor (fn_home_dashboard),
   * sin hacer query extra. Lo llama home.page.ts para reconciliar el BehaviorSubject
   * cuando quedó desincronizado: escenario de cold start offline donde
   * inicializarEstadoReactivo() falló sin red y la primera carga exitosa llega
   * después de recuperar conexión, o cuando el subject conserva un turno obsoleto.
   *
   * Acepta null para el caso inverso (servidor sin turno → limpiar turno fantasma).
   */
  sincronizarTurnoDesdeHome(turno: TurnoCajaConEmpleado | null): void {
    this._turnoActivo$.next(turno);
  }

  /**
   * Sincroniza el snapshot local del turno (turno_activo_local) con el estado real.
   * Habilita cobrar offline: el POS y el guard leen este snapshot cuando no hay red.
   *
   * Solo actúa con red: offline, `turno = null` puede significar "no hay turno" O
   * "la query falló por falta de red". Borrar el snapshot en ese caso destruiría el
   * turno válido que habilita el cobro offline. Sin red → no se toca el snapshot.
   * Con red, la lectura es confiable: hay turno → escribe; no hay → borra.
   */
  private async sincronizarSnapshotLocal(turno: TurnoCajaConEmpleado | null): Promise<void> {
    if (!this.network.isConnected()) return;

    if (turno) {
      await this.turnoLocal.guardar({
        turnoId:     turno.id,
        empleadoId:  turno.empleado_id,
        numeroTurno: turno.numero_turno,
        abiertoAt:   Date.now(),
      });
    } else {
      await this.turnoLocal.borrar();
    }
  }

  /**
   * Obtiene el turno activo (abierto) de hoy, si existe
   */
  async obtenerTurnoActivo(): Promise<TurnoCajaConEmpleado | null> {
    // Sin filtro de fecha: un turno abierto es uno con hora_fecha_cierre IS NULL,
    // independientemente de cuándo se abrió (puede ser de un día anterior no cerrado).
    const turno = await this.supabase.call<TurnoCajaConEmpleado>(
      this.supabase.client
        .from('turnos_caja')
        .select('*, empleado:usuarios(id, nombre)')
        .is('hora_fecha_cierre', null)
        .maybeSingle()
    );

    return turno;
  }

  /**
   * Abre un nuevo turno de caja mediante la función SQL atómica `abrir_turno`.
   *
   * Una sola transacción reemplaza las 3 queries separadas del enfoque anterior
   * (check open → count → insert), eliminando la race condition TOCTOU.
   *
   * Contrato del retorno (`feedback` le dice al caller QUÉ mostrar, sin re-derivar):
   *  - `ok: true`               → turno abierto. El caller muestra su overlay de éxito.
   *  - `feedback: 'silenciar'`  → sin red detectada (navegador sabe que no hay conexión):
   *    el banner global amarillo ya lo comunica → NO mostrar overlay redundante.
   *  - `feedback: 'red'`        → red "conectada pero rota" (timeout / transporte con el
   *    navegador creyendo que hay conexión): el banner NO aparece → mostrar overlay de red.
   *  - `feedback: 'mensaje'` + `errorMsg` → regla de negocio (ej. "Ya hay un turno abierto
   *    por X"). El texto lo redacta fn_abrir_turno; mostrarlo tal cual, nunca inventarlo.
   */
  async abrirTurno(fondoApertura: number = 0): Promise<TurnoMutacionResult> {
    const empleado = await this.authService.getUsuarioActual();
    if (!empleado) return { ok: false, feedback: 'mensaje', errorMsg: 'No se pudo obtener el empleado actual' };

    let response: unknown;
    try {
      response = await this.supabase.call(
        this.supabase.client.rpc('fn_abrir_turno', {
          p_empleado_id:    empleado.id,
          p_fondo_apertura: fondoApertura
        }),
        undefined,
        { timeoutMs: TIMING.turnoMutacionTimeoutMs, silentError: true }
      );
    } catch (error: any) {
      return { ok: false, ...this.clasificarErrorMutacion(error, 'No se pudo abrir el turno') };
    }

    // response === null → "sin red" detectado por call() (retorna null, no lanza).
    // El banner ya avisa → silenciar.
    if (response === null) return { ok: false, feedback: 'silenciar' };

    const data = response as any;
    // success: false → la BD rechazó por regla de negocio. Propagar su mensaje (data.error)
    // — es la fuente de verdad y describe la causa real (turno ya abierto, saldo, etc.).
    if (!data?.success) {
      return { ok: false, feedback: 'mensaje', errorMsg: data?.error ?? 'No se pudo abrir el turno' };
    }

    await this.refrescarTurnoActivo();

    // Overlay de éxito (no toast): lo muestra home.page.ts (onAbrirCaja) después de
    // este return, con el fondo declarado — ver design_toast_vs_overlay_feedback.md.

    // Priming de respaldo (Fase P, PLAN-OFFLINE-CALLE §2.9): si el arranque de la app
    // no llegó a precalentar el cache (o el snapshot ya venció), esta es la última red
    // garantizada antes de que el vendedor salga a la calle. Best-effort, no bloquea.
    void this.syncService.precalentarOffline();

    return { ok: true };
  }

  /**
   * Detecta si el último cierre tuvo déficit en la transferencia a VARIOS.
   * Con fondo libre ya no existe déficit de fondo — solo se verifica VARIOS.
   * Retorna null si no hay cierre previo o si VARIOS ya cobró ese día.
   */
  async obtenerDeficitTurnoAnterior(): Promise<{ deficitVarios: number } | null> {
    const data = await this.supabase.call<{ deficit_varios: number }>(
      this.supabase.client.rpc('fn_obtener_deficit_turno_anterior')
    );
    if (!data || data.deficit_varios <= 0) return null;
    return { deficitVarios: data.deficit_varios };
  }

  /**
   * Registra las operaciones contables para reparar el déficit del turno anterior.
   * Usa la función dedicada `reparar_deficit_turno`.
   * El RPC valida que Tienda tenga saldo suficiente — si no, retorna error con mensaje.
   *
   * Mismo contrato de retorno que abrirTurno (ver TurnoMutacionResult): `feedback` le
   * dice al modal qué mostrar en el fallo (silenciar / overlay de red / mensaje).
   */
  async repararDeficit(deficitVarios: number, fondoApertura: number): Promise<TurnoMutacionResult> {
    const empleado = await this.authService.getUsuarioActual();
    if (!empleado) return { ok: false, feedback: 'mensaje', errorMsg: 'No se pudo obtener el empleado actual' };

    // Las categorías DEF-RETIRAR y DEF-REPONER son UUIDs fijos en categorias_sistema —
    // fn_reparar_deficit_turno las resuelve internamente, no las recibe como parámetros.
    let response: unknown;
    try {
      response = await this.supabase.call(
        this.supabase.client.rpc('fn_reparar_deficit_turno', {
          p_empleado_id:    empleado.id,
          p_deficit_varios: deficitVarios,
          p_fondo_apertura: fondoApertura,
        }),
        undefined,
        { showLoading: true, timeoutMs: TIMING.turnoMutacionTimeoutMs, silentError: true }
      );
    } catch (error: any) {
      return { ok: false, ...this.clasificarErrorMutacion(error, 'Error inesperado al registrar el ajuste') };
    }

    // response === null → "sin red" detectado por call(). El banner ya avisa → silenciar.
    if (response === null) {
      return { ok: false, feedback: 'silenciar' };
    }

    const data = response as any;

    if (!data?.success) {
      return { ok: false, feedback: 'mensaje', errorMsg: data?.error || 'Error desconocido al registrar el ajuste' };
    }

    // Sincronizar turnoActivo$ proactivamente (la apertura con reparacion de
    // deficit es atomica en SQL y abre el turno en la misma transaccion).
    await this.refrescarTurnoActivo();

    return { ok: true, turnoId: data.turno_id };
  }

  /**
   * Compensa manualmente las transferencias diarias a Varios que no se realizaron
   * mientras el turno estuvo abierto varios días (fn_compensar_varios_pendiente).
   *
   * NO es una transferencia normal: usa categorías COMP-DIA-* que ningún check de cuota
   * diaria observa, así no contamina la transferencia del día en curso. El RPC valida el
   * saldo de Tienda; si no alcanza, retorna { ok:false, error } con el mensaje del backend.
   *
   * @param monto   monto total a compensar (dias × transferencia diaria)
   * @param detalle rango de días descriptivo para el historial, ej. "2 días (15/07–16/07)"
   */
  async compensarVariosPendiente(monto: number, detalle: string): Promise<{ ok: boolean; error?: string }> {
    const empleado = await this.authService.getUsuarioActual();
    if (!empleado) return { ok: false, error: 'No se pudo obtener el empleado actual' };

    let response: unknown;
    try {
      response = await this.supabase.call(
        this.supabase.client.rpc('fn_compensar_varios_pendiente', {
          p_empleado_id: empleado.id,
          p_monto:       monto,
          p_detalle:     detalle,
        }),
        undefined,
        { showLoading: true, silentError: true }
      );
    } catch (error: any) {
      if (this.supabase.debeSilenciarErrorOffline(error)) return { ok: false };
      return { ok: false, error: error?.message ?? 'No se pudo registrar la compensación' };
    }

    // response === null → "sin red" detectado por call(); el banner global ya avisa.
    if (response === null) return { ok: false };

    const data = response as any;
    if (!data?.success) {
      return { ok: false, error: data?.error || 'No se pudo registrar la compensación' };
    }

    // Refrescar saldos del home (Tienda bajó, Varios subió).
    await this.refrescarTurnoActivo();
    return { ok: true };
  }

  /**
   * Clasifica una excepción de una mutación de turno (relanzada por call() con
   * silentError) en la instrucción de feedback que el caller debe aplicar. Centraliza
   * aquí la decisión para que abrirTurno/repararDeficit no dupliquen el criterio:
   *  - sin red (navegador sabe que no hay conexión) → 'silenciar' (banner global cubre).
   *  - timeout / transporte con red "conectada pero rota" → 'red' (overlay de conexión).
   *  - excepción real del servidor (respondió con error) → 'mensaje' con su texto.
   */
  private clasificarErrorMutacion(error: any, mensajeFallback: string): Omit<TurnoMutacionResult, 'ok'> {
    if (this.supabase.debeSilenciarErrorOffline(error)) {
      return { feedback: 'silenciar' };
    }
    if (error instanceof TimeoutError || this.supabase.esErrorDeTransporte(error)) {
      return { feedback: 'red' };
    }
    return { feedback: 'mensaje', errorMsg: error?.message ?? mensajeFallback };
  }

  /**
   * Obtiene los turnos de una fecha específica (para selector en ventas).
   * Incluye nombre del empleado. Ordenados por numero_turno ASC.
   * @param fecha 'YYYY-MM-DD' — si no se pasa, usa la fecha de hoy
   */
  async obtenerTurnosDeFecha(fecha?: string): Promise<TurnoCajaConEmpleado[]> {
    const fechaLocal = fecha ?? getFechaLocal();
    const inicioDia = new Date(`${fechaLocal}T00:00:00`).toISOString();
    const finDia = getInicioDiaSiguienteDeISO(fechaLocal);

    const turnos = await this.supabase.call<TurnoCajaConEmpleado[]>(
      this.supabase.client
        .from('turnos_caja')
        .select('*, empleado:usuarios(id, nombre)')
        .gte('hora_fecha_apertura', inicioDia)
        .lt('hora_fecha_apertura', finDia)
        .order('numero_turno', { ascending: true })
    );

    return turnos ?? [];
  }


  /**
   * Snapshot consolidado del home en una sola RPC (~250-500ms vs ~400-800ms de
   * Promise.all con 9 queries individuales). Reemplaza las queries que el home
   * hacía por separado: estado de caja, saldos virtuales CELULAR/BUS y resumen
   * de ingresos/egresos del día (los métodos cliente fueron eliminados).
   *
   * v2.0: la RPC ya no devuelve la lista de movimientos — solo los agregados
   * ingresos/egresos del día completo para los deltas del hero.
   *
   * La RPC filtra todo por get_negocio_id() del JWT. Multi-tenant safe.
   */
  async obtenerHomeDashboard(): Promise<HomeDashboard> {
    const data = await this.supabase.call<{
      estado_caja: {
        turno_activo: TurnoCajaConEmpleado | null;
        turnos_hoy: number;
        fecha_ultimo_cierre: string | null;
      };
      saldos_virtuales: { celular: number; bus: number };
      resumen_dia: { ingresos: number; egresos: number };
      saldos_cajas: Caja[];
      modulos: { varios_activa: boolean; celular_habilitada: boolean; bus_habilitada: boolean };
    }>(
      this.supabase.client.rpc('fn_home_dashboard')
    );

    // Sin respuesta (offline o error de red): servir el último snapshot CRUDO (no
    // degradado) en vez de pintar el home en ceros — si el usuario sigue offline con
    // un turno de ayer abierto, necesita seguir viendo ese turno para operar POS/Cajón.
    // Si tampoco hay snapshot, sigue el flujo con defaults.
    if (!data) {
      const cacheado = await this.leerSnapshotCrudo();
      if (cacheado) return cacheado;
    }

    // Defaults defensivos si la RPC retornó null (shouldn't happen pero por las dudas)
    const ec  = data?.estado_caja      ?? { turno_activo: null, turnos_hoy: 0, fecha_ultimo_cierre: null };
    const sv  = data?.saldos_virtuales ?? { celular: 0, bus: 0 };
    const res = data?.resumen_dia      ?? { ingresos: 0, egresos: 0 };
    const caj = data?.saldos_cajas     ?? [];
    const mod = data?.modulos          ?? { varios_activa: false, celular_habilitada: false, bus_habilitada: false };

    // Calcular estado a partir del turno activo y turnos del día
    let estado: EstadoCajaTipo;
    let empleadoNombre = '';
    let horaApertura = '';

    if (ec.turno_activo) {
      estado = 'TURNO_EN_CURSO';
      empleadoNombre = ec.turno_activo.empleado?.nombre || '';
      horaApertura = new Date(ec.turno_activo.hora_fecha_apertura).toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } else if (ec.turnos_hoy > 0) {
      estado = 'CERRADA';
    } else {
      estado = 'SIN_ABRIR';
    }

    const dashboard: HomeDashboard = {
      estadoCaja: {
        estado,
        turnoActivo:       ec.turno_activo,
        empleadoNombre,
        horaApertura,
        turnosHoy:         ec.turnos_hoy,
        fechaUltimoCierre: ec.fecha_ultimo_cierre,
      },
      saldoVirtualCelular: sv.celular  ?? 0,
      saldoVirtualBus:     sv.bus      ?? 0,
      ingresosHoy:         res.ingresos ?? 0,
      egresosHoy:          res.egresos  ?? 0,
      cajas:               caj,
      modulos: {
        variosActiva:      mod.varios_activa      ?? false,
        celularHabilitada: mod.celular_habilitada ?? false,
        busHabilitada:     mod.bus_habilitada     ?? false,
      },
    };

    // Persistir solo datos reales del servidor — nunca los defaults de un null
    if (data) this.guardarHomeDashboardCache(dashboard);

    return dashboard;
  }

  // ==========================================
  // SNAPSHOT PERSISTIDO DEL HOME (stale-while-revalidate)
  // ==========================================

  // v2 (2026-07-03): el shape cambió (ingresosHoy/egresosHoy en vez de la lista de
  // movimientos). Bump de la key para que un snapshot v1 persistido no se pinte con
  // campos undefined en el hero — el primer arranque tras actualizar muestra skeleton
  // una vez y desde ahí el snapshot v2 toma el relevo.
  private static readonly HOME_DASHBOARD_CACHE_KEY = 'mi-tienda:home-dashboard-cache:v2';

  /**
   * Último snapshot CRUDO del dashboard persistido en Preferences, tal cual se guardó
   * (sin importar el día), o null si no hay o es de otro negocio. Uso exclusivo: fallback
   * offline en `obtenerHomeDashboard()` cuando la RPC no responde por falta de red — ahí
   * SÍ hace falta el turno tal cual estaba (si el usuario sigue offline con un turno de
   * ayer abierto, necesita seguir viendo ese turno para operar POS/Cajón). No usar este
   * método para el pintado optimista del home — ver `obtenerHomeDashboardCacheado()`.
   */
  private async leerSnapshotCrudo(): Promise<HomeDashboard | null> {
    try {
      const { value } = await Preferences.get({ key: TurnosCajaService.HOME_DASHBOARD_CACHE_KEY });
      if (!value) return null;

      const snapshot: HomeDashboardSnapshot = JSON.parse(value);

      // Invalidación automática al cambiar de tenant
      if (snapshot.negocio_id !== (this.authService.usuarioActualValue?.negocio_id ?? null)) return null;

      return snapshot.data;
    } catch {
      return null;
    }
  }

  /**
   * Snapshot del dashboard para el pintado optimista del home (stale-while-revalidate
   * con conexión disponible). A diferencia de `leerSnapshotCrudo()`, un snapshot de
   * OTRO día se DEGRADA en vez de descartarse: los saldos de cajas y flags de módulos
   * no son diarios (son vaults que persisten), solo el turno y los deltas del día sí.
   *
   * Por qué esto importa: el arranque tras reposo largo más frecuente es la primera
   * apertura de cada mañana — descartar el snapshot completo en ese caso (como se hacía
   * antes) forzaba skeleton + espera de red exactamente en el escenario más común. Con
   * la degradación, el home aparece lleno (saldos reales) todos los días, con el turno
   * en estado neutro hasta que el fetch fresco (que corre en paralelo) lo reconcilie
   * en ~1s — mismo criterio de "mejor un dato levemente stale que una pantalla vacía"
   * ya aceptado para el resto del stale-while-revalidate de esta clase.
   */
  async obtenerHomeDashboardCacheado(): Promise<HomeDashboard | null> {
    try {
      const { value } = await Preferences.get({ key: TurnosCajaService.HOME_DASHBOARD_CACHE_KEY });
      if (!value) return null;

      const snapshot: HomeDashboardSnapshot = JSON.parse(value);

      // Invalidación automática al cambiar de tenant
      if (snapshot.negocio_id !== (this.authService.usuarioActualValue?.negocio_id ?? null)) return null;

      // Mismo día local → snapshot tal cual (el turno/deltas siguen vigentes)
      if (snapshot.fecha === getFechaLocal()) return snapshot.data;

      // Otro día → degradar: saldos y módulos sí, turno/deltas se resetean a neutro.
      // Sin esto el chip mostraría "TURNO_EN_CURSO" de un turno que probablemente ya
      // se cerró, o "CERRADA" bloqueando un botón que hoy debería decir "Abrir caja".
      return {
        ...snapshot.data,
        estadoCaja: {
          estado: 'SIN_ABRIR',
          turnoActivo: null,
          empleadoNombre: '',
          horaApertura: '',
          turnosHoy: 0,
          fechaUltimoCierre: snapshot.data.estadoCaja.fechaUltimoCierre,
        },
        ingresosHoy: 0,
        egresosHoy: 0,
      };
    } catch {
      return null;
    }
  }

  /** Persiste el snapshot del dashboard. Best-effort: un fallo no afecta el flujo. */
  private guardarHomeDashboardCache(dashboard: HomeDashboard): void {
    const snapshot: HomeDashboardSnapshot = {
      negocio_id: this.authService.usuarioActualValue?.negocio_id ?? null,
      fecha:      getFechaLocal(),
      data:       dashboard,
    };
    Preferences.set({
      key:   TurnosCajaService.HOME_DASHBOARD_CACHE_KEY,
      value: JSON.stringify(snapshot),
    }).catch(() => {});
  }

  /**
   * Datos iniciales del wizard de cierre diario en una sola RPC (fn_datos_cierre_diario).
   * Reemplaza las 8-9 queries paralelas que hacía cargarDatosIniciales().
   */
  async obtenerDatosCierreDiario(): Promise<DatosCierreDiario> {
    const data = await this.supabase.call<{
      turno_activo: any | null;
      saldos_virtuales:      { celular: number; bus: number };
      snapshot_virtuales:    { celular: number; bus: number };
      agregado_virtual_hoy:  { celular: number; bus: number };
      saldos_cajas:          { caja_chica_digital: number; caja_celular: number; caja_bus: number };
      saldos_antes_cierre:   { caja: number; varios: number };
      transferencia_diaria_varios: number;
      transferencia_ya_hecha: boolean;
      varios_pendiente:      { dias: number; monto: number; desde: string | null; hasta: string | null };
      resumen_turno:         { ventas_pos_efectivo: number; egresos: number };
      configuracion:         { recargas_celular_habilitada: boolean; recargas_bus_habilitada: boolean; caja_varios_activa: boolean };
    }>(
      this.supabase.client.rpc('fn_datos_cierre_diario')
    );

    const sv  = data?.saldos_virtuales      ?? { celular: 0, bus: 0 };
    const sn  = data?.snapshot_virtuales    ?? { celular: 0, bus: 0 };
    const ag  = data?.agregado_virtual_hoy  ?? { celular: 0, bus: 0 };
    const sc  = data?.saldos_cajas          ?? { caja_chica_digital: 0, caja_celular: 0, caja_bus: 0 };
    const sac = data?.saldos_antes_cierre   ?? { caja: 0, varios: 0 };
    const vp  = data?.varios_pendiente      ?? { dias: 0, monto: 0, desde: null, hasta: null };
    const rt  = data?.resumen_turno         ?? { ventas_pos_efectivo: 0, egresos: 0 };
    const cfg = data?.configuracion         ?? { recargas_celular_habilitada: false, recargas_bus_habilitada: false, caja_varios_activa: false };

    return {
      turnoActivo:               data?.turno_activo ?? null,
      saldosVirtuales:           { celular: sv.celular ?? 0,  bus: sv.bus ?? 0 },
      snapshotVirtuales:         { celular: sn.celular ?? 0,  bus: sn.bus ?? 0 },
      agregadoVirtualHoy:        { celular: ag.celular ?? 0,  bus: ag.bus ?? 0 },
      saldosCajas:               { cajaChicaDigital: sc.caja_chica_digital ?? 0, cajaCelular: sc.caja_celular ?? 0, cajaBus: sc.caja_bus ?? 0 },
      saldosAntesCierre:         { caja: sac.caja ?? 0, varios: sac.varios ?? 0 },
      transferenciaDiariaVarios: data?.transferencia_diaria_varios ?? 0,
      transferenciaYaHecha:      data?.transferencia_ya_hecha      ?? false,
      variosPendiente:           { dias: vp.dias ?? 0, monto: vp.monto ?? 0, desde: vp.desde ?? null, hasta: vp.hasta ?? null },
      resumenTurno:              { ventasPosEfectivo: rt.ventas_pos_efectivo ?? 0, egresos: rt.egresos ?? 0 },
      configuracion: {
        recargasCelularHabilitada: cfg.recargas_celular_habilitada ?? false,
        recargasBusHabilitada:     cfg.recargas_bus_habilitada     ?? false,
        cajaVariosActiva:          cfg.caja_varios_activa          ?? false,
      },
    };
  }
}
