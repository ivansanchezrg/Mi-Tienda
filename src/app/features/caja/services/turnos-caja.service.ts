import { Injectable, inject, NgZone } from '@angular/core';
import { BehaviorSubject, map, distinctUntilChanged, combineLatest, filter, firstValueFrom } from 'rxjs';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '@core/services/supabase.service';
import { UiService } from '@core/services/ui.service';
import { LoggerService } from '@core/services/logger.service';
import { ConfigService } from '@core/services/config.service';
import { AuthService } from '../../auth/services/auth.service';
import { TurnoCaja, TurnoCajaConEmpleado, EstadoCaja, EstadoCajaTipo } from '../models/turno-caja.model';
import { OperacionCaja } from '../models/operacion-caja.model';
import { getFechaLocal, getInicioDiaSiguienteISO, getInicioDiaSiguienteDeISO } from '@core/utils/date.util';

/**
 * Snapshot consolidado del dashboard del home (devuelto por la RPC fn_home_dashboard).
 * Reemplaza las múltiples llamadas paralelas que hacía home.cargarDatos().
 */
export interface HomeDashboard {
  estadoCaja: EstadoCaja;
  saldoVirtualCelular: number;
  saldoVirtualBus: number;
  ultimosMovimientos: OperacionCaja[];
  totalMovimientosHoy: number;
}

@Injectable({
  providedIn: 'root'
})
export class TurnosCajaService {
  private supabase = inject(SupabaseService);
  private authService = inject(AuthService);
  private ui = inject(UiService);
  private logger = inject(LoggerService);
  private configService = inject(ConfigService);
  private zone = inject(NgZone);

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
      const turno = await this.obtenerTurnoActivo();
      this._turnoActivo$.next(turno);
      this.abrirRealtimeTurnos();
    } catch (err) {
      this.logger.error('TurnosCajaService', 'Error al inicializar estado reactivo', err);
    } finally {
      this._inicializado$.next(true);
    }
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
        this.logger.info('TurnosCajaService', 'Turno abierto detectado en tiempo real');
      }
      return;
    }

    if (eventType === 'UPDATE') {
      // Si el turno que estaba activo se cerro, bajar el estado a null
      if (actual && nuevo && nuevo.id === actual.id && nuevo.hora_fecha_cierre) {
        this._turnoActivo$.next(null);
        this.logger.info('TurnosCajaService', 'Turno cerrado detectado en tiempo real');
        return;
      }
      // Caso borde: un turno se reabrio (no deberia pasar, pero protegemos)
      if (!actual && nuevo && !nuevo.hora_fecha_cierre) {
        const turno = await this.obtenerTurnoActivo();
        this._turnoActivo$.next(turno);
      }
      return;
    }

    if (eventType === 'DELETE') {
      if (actual && viejo && viejo.id === actual.id) {
        this._turnoActivo$.next(null);
        this.logger.warn('TurnosCajaService', 'Turno eliminado en tiempo real');
      }
    }
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
   * Retorna false tanto si ya hay turno abierto como si hay error de conexión —
   * home.page.ts maneja el error verificando si el turno existe tras el fallo.
   */
  async abrirTurno(fondoApertura: number = 0): Promise<{ ok: boolean; errorHandled: boolean }> {
    const empleado = await this.authService.getUsuarioActual();
    if (!empleado) return { ok: false, errorHandled: false };

    const response = await this.supabase.call(
      this.supabase.client.rpc('fn_abrir_turno', {
        p_empleado_id:    empleado.id,
        p_fondo_apertura: fondoApertura
      })
    );

    // response === null → supabase.call() ya mostró el toast del error SQL
    if (response === null) return { ok: false, errorHandled: true };

    const data = response as any;
    // success: false → turno ya existía (race condition); home verifica cuál es el caso
    if (!data?.success) return { ok: false, errorHandled: false };

    await this.refrescarTurnoActivo();
    await this.ui.showSuccess('Caja abierta');
    return { ok: true, errorHandled: false };
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
   * Retorna { ok: true } si todo OK, o { ok: false, errorMsg } con el mensaje del RPC.
   */
  async repararDeficit(deficitVarios: number, fondoApertura: number): Promise<{ ok: boolean; turnoId?: string; errorMsg?: string }> {
    const empleado = await this.authService.getUsuarioActual();
    if (!empleado) return { ok: false, errorMsg: 'No se pudo obtener el empleado actual' };

    // Las categorías DEF-RETIRAR y DEF-REPONER son UUIDs fijos en categorias_sistema —
    // fn_reparar_deficit_turno las resuelve internamente, no las recibe como parámetros.
    const response = await this.supabase.call(
      this.supabase.client.rpc('fn_reparar_deficit_turno', {
        p_empleado_id:    empleado.id,
        p_deficit_varios: deficitVarios,
        p_fondo_apertura: fondoApertura,
      }),
      undefined,
      { showLoading: true }
    );

    if (response === null) {
      return { ok: false, errorMsg: 'Error de conexión con el servidor' };
    }

    const data = response as any;

    if (!data?.success) {
      return { ok: false, errorMsg: data?.error || 'Error desconocido al registrar el ajuste' };
    }

    // Sincronizar turnoActivo$ proactivamente (la apertura con reparacion de
    // deficit es atomica en SQL y abre el turno en la misma transaccion).
    await this.refrescarTurnoActivo();

    return { ok: true, turnoId: data.turno_id };
  }

  /**
   * Resumen de ingresos y egresos del cajón para el turno activo (v5).
   *
   * Usado en el Paso 2 del wizard de cierre para mostrar la conciliación real:
   *   + Ventas POS en efectivo  (tabla ventas, turno_id + metodo_pago = EFECTIVO)
   *   + Otros ingresos manuales (= saldoCajaChicaDigital - ventasPOS + egresos)
   *   − Egresos / gastos        (operaciones_cajas EGRESO en CAJA_CHICA)
   *   = Neto del turno          (= saldoCajaChicaDigital)
   *
   * @param turnoId       UUID del turno activo
   * @param horaApertura  ISO timestamp de apertura del turno (para filtrar operaciones)
   */
  async getResumenTurnoActual(
    turnoId: string,
    horaApertura: string
  ): Promise<{ ventasPosEfectivo: number; egresos: number }> {
    // 1. ID de CAJA_CHICA (sin overlay — lectura rápida)
    const { data: cajaChica } = await this.supabase.client
      .from('cajas')
      .select('id')
      .eq('codigo', 'CAJA_CHICA')
      .single();

    if (!cajaChica) return { ventasPosEfectivo: 0, egresos: 0 };

    // 2. Ventas POS en efectivo del turno + egresos del cajón en paralelo
    const [ventasRes, egresosRes] = await Promise.all([
      // Ventas POS: efectivo completadas en este turno
      this.supabase.client
        .from('ventas')
        .select('total')
        .eq('turno_id', turnoId)
        .eq('metodo_pago', 'EFECTIVO')
        .eq('estado', 'COMPLETADA'),

      // Egresos registrados en CAJA_CHICA desde la apertura del turno
      this.supabase.client
        .from('operaciones_cajas')
        .select('monto')
        .eq('caja_id', cajaChica.id)
        .eq('tipo_operacion', 'EGRESO')
        .gte('fecha', horaApertura)
    ]);

    const ventasPosEfectivo = (ventasRes.data ?? [])
      .reduce((sum: number, v: any) => sum + (v.total ?? 0), 0);

    const egresos = (egresosRes.data ?? [])
      .reduce((sum: number, o: any) => sum + (o.monto ?? 0), 0);

    return { ventasPosEfectivo, egresos };
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
   * Obtiene el estado completo de la caja para mostrar en el banner
   */
  async obtenerEstadoCaja(): Promise<EstadoCaja> {
    const inicioDia = new Date(`${getFechaLocal()}T00:00:00`).toISOString();
    const inicioMana = getInicioDiaSiguienteISO();

    const [turnoActivo, countResult, ultimoCierre] = await Promise.all([
      this.supabase.call<TurnoCajaConEmpleado>(
        this.supabase.client
          .from('turnos_caja')
          .select('*, empleado:usuarios(id, nombre)')
          .is('hora_fecha_cierre', null)
          .maybeSingle(),
        undefined,
        { showLoading: false }
      ),
      this.supabase.client
        .from('turnos_caja')
        .select('id', { count: 'exact', head: true })
        .gte('hora_fecha_apertura', inicioDia)
        .lt('hora_fecha_apertura', inicioMana),
      this.supabase.call<{ hora_fecha_cierre: string }>(
        this.supabase.client
          .from('turnos_caja')
          .select('hora_fecha_cierre')
          .not('hora_fecha_cierre', 'is', null)
          .order('hora_fecha_cierre', { ascending: false })
          .limit(1)
          .maybeSingle()
      )
    ]);

    const turnosHoy = countResult.count ?? 0;

    let estado: EstadoCajaTipo;
    let empleadoNombre = '';
    let horaApertura = '';

    if (turnoActivo) {
      estado = 'TURNO_EN_CURSO';
      empleadoNombre = turnoActivo.empleado?.nombre || '';
      horaApertura = new Date(turnoActivo.hora_fecha_apertura).toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } else if (turnosHoy > 0) {
      estado = 'CERRADA';
    } else {
      estado = 'SIN_ABRIR';
    }

    const fechaUltimoCierre = ultimoCierre?.hora_fecha_cierre
      ? (() => {
          const d = new Date(ultimoCierre.hora_fecha_cierre);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        })()
      : null;

    return {
      estado,
      turnoActivo,
      empleadoNombre,
      horaApertura,
      turnosHoy,
      fechaUltimoCierre
    };
  }

  /**
   * Snapshot consolidado del home en una sola RPC (~250-500ms vs ~400-800ms de
   * Promise.all con 9 queries individuales). Reemplaza la combinación de:
   *   - obtenerEstadoCaja()
   *   - getSaldoVirtualActual('CELULAR' | 'BUS') x2
   *   - obtenerUltimosMovimientos()
   *   - contarMovimientosHoy()
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
      movimientos: { lista: OperacionCaja[]; total: number };
    }>(
      this.supabase.client.rpc('fn_home_dashboard')
    );

    // Defaults defensivos si la RPC retornó null (shouldn't happen pero por las dudas)
    const ec = data?.estado_caja ?? { turno_activo: null, turnos_hoy: 0, fecha_ultimo_cierre: null };
    const sv = data?.saldos_virtuales ?? { celular: 0, bus: 0 };
    const mov = data?.movimientos ?? { lista: [], total: 0 };

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

    return {
      estadoCaja: {
        estado,
        turnoActivo:       ec.turno_activo,
        empleadoNombre,
        horaApertura,
        turnosHoy:         ec.turnos_hoy,
        fechaUltimoCierre: ec.fecha_ultimo_cierre,
      },
      saldoVirtualCelular: sv.celular ?? 0,
      saldoVirtualBus:     sv.bus     ?? 0,
      ultimosMovimientos:  mov.lista  ?? [],
      totalMovimientosHoy: mov.total  ?? 0,
    };
  }
}
