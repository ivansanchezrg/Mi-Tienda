import { Injectable, inject, NgZone } from '@angular/core';
import { BehaviorSubject, map, distinctUntilChanged } from 'rxjs';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '@core/services/supabase.service';
import { UiService } from '@core/services/ui.service';
import { LoggerService } from '@core/services/logger.service';
import { ConfigService } from '@core/services/config.service';
import { AuthService } from '../../auth/services/auth.service';
import { TurnoCaja, TurnoCajaConEmpleado, EstadoCaja, EstadoCajaTipo, ResultadoCierreEmergencia } from '../models/turno-caja.model';
import { getFechaLocal, getInicioDiaSiguienteISO, getInicioDiaSiguienteDeISO } from '@core/utils/date.util';

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
   * Derivado: true si hay caja abierta (turno activo no-null).
   * Usado por guards, layout y sidebar para habilitar/deshabilitar secciones
   * del app que dependen de un turno en curso (POS, Cajon).
   */
  readonly cajaAbierta$ = this._turnoActivo$.pipe(
    map(t => t !== null),
    distinctUntilChanged()
  );

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
        // logout / sesion expirada → reset defensivo (el hook beforeCleanup
        // tambien lo hace, pero dejar ambos garantiza consistencia).
        this._turnoActivo$.next(null);
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
    }
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
   * Obtiene el fondo fijo diario desde configuraciones (usa caché)
   */
  async obtenerFondoFijo(): Promise<number> {
    const config = await this.configService.get();
    return config.caja_fondo_fijo_diario;
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
  async abrirTurno(): Promise<boolean> {
    const empleado = await this.authService.getUsuarioActual();
    if (!empleado) return false;

    const response = await this.supabase.call(
      this.supabase.client.rpc('fn_abrir_turno', {
        p_empleado_id: empleado.id
      }),
      undefined,
      { showLoading: true }
    );

    if (response === null) return false;

    const data = response as any;
    if (!data?.success) return false; // home.page.ts verifica si el turno ya existía

    // Sincronizamos turnoActivo$ de forma proactiva para que el layout (tab POS)
    // y el sidebar reaccionen sin esperar al round-trip del evento Realtime INSERT.
    // El evento Realtime luego dispara un refetch idempotente, no duplica nada.
    await this.refrescarTurnoActivo();

    await this.ui.showSuccess('Caja abierta');
    return true;
  }

  /**
   * Detecta si el último cierre tuvo déficit en la transferencia a VARIOS (v5).
   *
   * En v5 no existe caja_fisica_diaria. El déficit se detecta verificando si VARIOS
   * recibió su TRANSFERENCIA_ENTRANTE en el último día con cierre.
   * Si NO la recibió → deficit = varios_transferencia_diaria (monto completo).
   *
   * Retorna null si no hay cierre previo o si el último cierre fue normal (sin déficit).
   */
  async obtenerDeficitTurnoAnterior(): Promise<{ deficitVarios: number; fondoFaltante: number } | null> {
    // 1. Obtener el último turno cerrado con su estado de fondo
    const { data: ultimoTurno, error: turnoError } = await this.supabase.client
      .from('turnos_caja')
      .select('hora_fecha_cierre, fondo_cubierto')
      .not('hora_fecha_cierre', 'is', null)
      .order('hora_fecha_cierre', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (turnoError || !ultimoTurno) return null;

    // 2. Obtener fecha local del último cierre
    const fechaUltimoCierre = new Date(ultimoTurno.hora_fecha_cierre);
    const anio = fechaUltimoCierre.getFullYear();
    const mes = String(fechaUltimoCierre.getMonth() + 1).padStart(2, '0');
    const dia = String(fechaUltimoCierre.getDate()).padStart(2, '0');
    const fechaLocalCierre = `${anio}-${mes}-${dia}`;

    // 3. Verificar si VARIOS recibió su transferencia ese día en paralelo con config
    const [variosRes, config] = await Promise.all([
      this.supabase.client.from('cajas').select('id').eq('codigo', 'VARIOS').single(),
      this.configService.get()
    ]);

    if (!variosRes.data) return null;

    const inicioUtc = new Date(`${fechaLocalCierre}T00:00:00`).toISOString();
    const finUtc    = getInicioDiaSiguienteDeISO(fechaLocalCierre);

    // Busca cualquier operación que marque el pago a VARIOS ese día:
    //   TRANSFERENCIA_ENTRANTE → cierre normal
    //   INGRESO categoria IN-004 → reparación de déficit al abrir (reparar_deficit_turno)
    const [transferenciaRes, ingresoDeficitRes] = await Promise.all([
      this.supabase.client
        .from('operaciones_cajas')
        .select('id')
        .eq('caja_id', variosRes.data.id)
        .gte('fecha', inicioUtc)
        .lte('fecha', finUtc)
        .eq('tipo_operacion', 'TRANSFERENCIA_ENTRANTE')
        .limit(1)
        .maybeSingle(),

      this.supabase.client
        .from('operaciones_cajas')
        .select('id, categoria_id, categorias_operaciones!inner(codigo)')
        .eq('caja_id', variosRes.data.id)
        .gte('fecha', inicioUtc)
        .lte('fecha', finUtc)
        .eq('tipo_operacion', 'INGRESO')
        .eq('categorias_operaciones.codigo', 'IN-004')
        .limit(1)
        .maybeSingle()
    ]);

    // 4. Calcular montos independientemente para los dos déficits posibles:
    //    - deficitVarios: 0 si VARIOS ya cobró (transferencia o INGRESO IN-004), monto config si no
    //    - fondoFaltante:    0 si fondo_cubierto = TRUE, monto config si FALSE
    //    Ambos son independientes: puede haber solo uno, ambos, o ninguno.
    const variosYaCobro = !!(transferenciaRes.data || ingresoDeficitRes.data);

    const deficitVarios = variosYaCobro
      ? 0
      : config.caja_varios_transferencia_dia;

    const fondoFaltante = ultimoTurno.fondo_cubierto === false
      ? config.caja_fondo_fijo_diario
      : 0;

    // Solo hay déficit si al menos uno de los dos montos es positivo
    if (deficitVarios <= 0 && fondoFaltante <= 0) return null;

    return { deficitVarios, fondoFaltante };
  }

  /**
   * Registra las operaciones contables para reparar el déficit del turno anterior.
   * Usa la función dedicada `reparar_deficit_turno`.
   * El RPC valida que Tienda tenga saldo suficiente — si no, retorna error con mensaje.
   *
   * Retorna { ok: true } si todo OK, o { ok: false, errorMsg } con el mensaje del RPC.
   */
  async repararDeficit(deficitVarios: number, fondoFaltante: number): Promise<{ ok: boolean; turnoId?: string; errorMsg?: string }> {
    const empleado = await this.authService.getUsuarioActual();
    if (!empleado) return { ok: false, errorMsg: 'No se pudo obtener el empleado actual' };

    const { data: categorias, error: catError } = await this.supabase.client
      .from('categorias_operaciones')
      .select('id, codigo')
      .in('codigo', ['EG-012', 'IN-004']);

    if (catError || !categorias || categorias.length < 2) {
      return { ok: false, errorMsg: 'No se encontraron las categorías de ajuste (EG-012 / IN-004). Ejecuta la migración SQL.' };
    }

    const catEgreso = categorias.find(c => c.codigo === 'EG-012');
    const catIngreso = categorias.find(c => c.codigo === 'IN-004');

    if (!catEgreso || !catIngreso) {
      return { ok: false, errorMsg: 'Categorías de ajuste incompletas en la base de datos.' };
    }

    const response = await this.supabase.call(
      this.supabase.client.rpc('fn_reparar_deficit_turno', {
        p_empleado_id: empleado.id,
        p_deficit_varios: deficitVarios,
        p_fondo_faltante: fondoFaltante,
        p_cat_egreso_id: catEgreso.id,
        p_cat_ingreso_id: catIngreso.id
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
   * Ejecuta el cierre de emergencia de un turno abierto por un empleado ausente.
   * Solo disponible para administradores.
   *
   * Delega toda la lógica a fn_cierre_emergencia_turno que:
   *   - Valida rol ADMIN del caller
   *   - Aplica la distribución en cascada igual que el cierre normal
   *   - Registra FALTANTE_CAJA si hay diferencia negativa de conteo
   *   - Cierra el turno con observaciones "CIERRE DE EMERGENCIA"
   *   - NO procesa recargas virtuales (el admin las gestiona manualmente)
   */
  async cerrarEmergencia(params: {
    adminId: string;
    turnoId: string;
    efectivoFisico: number;
    motivo?: string;
  }): Promise<ResultadoCierreEmergencia | null> {
    const response = await this.supabase.call<ResultadoCierreEmergencia>(
      this.supabase.client.rpc('fn_cierre_emergencia_turno', {
        p_admin_id:        params.adminId,
        p_turno_id:        params.turnoId,
        p_efectivo_fisico: params.efectivoFisico,
        p_motivo:          params.motivo ?? null
      }),
      undefined,
      { showLoading: true }
    );

    return response;
  }

  /**
   * Obtiene el estado completo de la caja para mostrar en el banner
   */
  async obtenerEstadoCaja(): Promise<EstadoCaja> {
    const inicioDia = new Date(`${getFechaLocal()}T00:00:00`).toISOString();
    const inicioMana = getInicioDiaSiguienteISO();

    const turnoActivo = await this.supabase.call<TurnoCajaConEmpleado>(
      this.supabase.client
        .from('turnos_caja')
        .select('*, empleado:usuarios(id, nombre)')
        .is('hora_fecha_cierre', null)
        .maybeSingle(),
      undefined,
      { showLoading: false }
    );

    const { count } = await this.supabase.client
      .from('turnos_caja')
      .select('id', { count: 'exact', head: true })
      .gte('hora_fecha_apertura', inicioDia)
      .lt('hora_fecha_apertura', inicioMana);

    const turnosHoy = count ?? 0;

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

    return {
      estado,
      turnoActivo,
      empleadoNombre,
      horaApertura,
      turnosHoy
    };
  }
}
