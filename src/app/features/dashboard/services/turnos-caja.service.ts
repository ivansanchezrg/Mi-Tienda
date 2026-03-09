import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { UiService } from '@core/services/ui.service';
import { AuthService } from '../../auth/services/auth.service';
import { TurnoCajaConEmpleado, EstadoCaja, EstadoCajaTipo } from '../models/turno-caja.model';
import { getFechaLocal } from '@core/utils/date.util';

@Injectable({
  providedIn: 'root'
})
export class TurnosCajaService {
  private supabase = inject(SupabaseService);
  private authService = inject(AuthService);
  private ui = inject(UiService);

  /**
   * Obtiene el fondo fijo diario desde configuraciones
   */
  async obtenerFondoFijo(): Promise<number> {
    const config = await this.supabase.client
      .from('configuraciones')
      .select('fondo_fijo_diario')
      .single();

    return config.data?.fondo_fijo_diario ?? 40.00;
  }

  /**
   * Obtiene el turno activo (abierto) de hoy, si existe
   */
  async obtenerTurnoActivo(): Promise<TurnoCajaConEmpleado | null> {
    const fechaHoy = getFechaLocal();
    const inicioDia = new Date(`${fechaHoy}T00:00:00`).toISOString();
    const finDia = new Date(`${fechaHoy}T23:59:59`).toISOString();

    const turno = await this.supabase.call<TurnoCajaConEmpleado>(
      this.supabase.client
        .from('turnos_caja')
        .select('*, empleado:usuarios(id, nombre)')
        .gte('hora_fecha_apertura', inicioDia)
        .is('hora_fecha_cierre', null)
        .maybeSingle()
    );

    return turno;
  }

  /**
   * Abre un nuevo turno de caja.
   * Valida que no haya un turno abierto antes de crear uno nuevo.
   */
  async abrirTurno(): Promise<boolean> {
    const fechaHoy = getFechaLocal();
    const inicioDia = new Date(`${fechaHoy}T00:00:00`).toISOString();
    const finDia = new Date(`${fechaHoy}T23:59:59`).toISOString();

    // Validar: no debe haber turno abierto
    const { data: turnoAbierto } = await this.supabase.client
      .from('turnos_caja')
      .select('id')
      .gte('hora_fecha_apertura', inicioDia)
      .lte('hora_fecha_apertura', finDia)
      .is('hora_fecha_cierre', null)
      .maybeSingle();

    if (turnoAbierto) {
      return false; // Ya hay turno abierto
    }

    // Obtener empleado actual
    const empleado = await this.authService.getUsuarioActual();
    if (!empleado) {
      return false;
    }

    // Calcular número de turno (siguiente al último del día)
    const { count } = await this.supabase.client
      .from('turnos_caja')
      .select('id', { count: 'exact', head: true })
      .gte('hora_fecha_apertura', inicioDia)
      .lte('hora_fecha_apertura', finDia);

    const numeroTurno = (count ?? 0) + 1;

    // Insertar turno (.select().single() necesario: INSERT sin select devuelve data:null
    // aunque sea exitoso, lo que supabase.call() interpreta incorrectamente como error)
    const response = await this.supabase.call(
      this.supabase.client
        .from('turnos_caja')
        .insert({
          numero_turno: numeroTurno,
          empleado_id: empleado.id,
          hora_fecha_apertura: new Date().toISOString() // TIMESTAMPTZ: UTC correcto
        })
        .select()
        .single(),
      undefined,
      { showLoading: true }
    );

    if (response === null) {
      // El error ya lo maneja supabase.call con ui.showError
      return false;
    }

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
  async obtenerDeficitTurnoAnterior(): Promise<{ deficitCajaChica: number; fondoFaltante: number } | null> {
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
    const [variosRes, configRes] = await Promise.all([
      this.supabase.client.from('cajas').select('id').eq('codigo', 'VARIOS').single(),
      this.supabase.client.from('configuraciones').select('fondo_fijo_diario, varios_transferencia_diaria').single()
    ]);

    if (!variosRes.data) return null;

    const inicioDia = `${fechaLocalCierre}T00:00:00`;
    const finDia    = `${fechaLocalCierre}T23:59:59`;
    const inicioUtc = new Date(inicioDia).toISOString();
    const finUtc    = new Date(finDia).toISOString();

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
    //    - deficitCajaChica: 0 si VARIOS ya cobró (transferencia o INGRESO IN-004), monto config si no
    //    - fondoFaltante:    0 si fondo_cubierto = TRUE, monto config si FALSE
    //    Ambos son independientes: puede haber solo uno, ambos, o ninguno.
    const variosYaCobro = !!(transferenciaRes.data || ingresoDeficitRes.data);

    const deficitCajaChica = variosYaCobro
      ? 0
      : (configRes.data?.varios_transferencia_diaria ?? 0);

    const fondoFaltante = ultimoTurno.fondo_cubierto === false
      ? (configRes.data?.fondo_fijo_diario ?? 0)
      : 0;

    // Solo hay déficit si al menos uno de los dos montos es positivo
    if (deficitCajaChica <= 0 && fondoFaltante <= 0) return null;

    return { deficitCajaChica, fondoFaltante };
  }

  /**
   * Registra las operaciones contables para reparar el déficit del turno anterior.
   * Usa la función dedicada `reparar_deficit_turno`.
   * El RPC valida que Tienda tenga saldo suficiente — si no, retorna error con mensaje.
   *
   * Retorna { ok: true } si todo OK, o { ok: false, errorMsg } con el mensaje del RPC.
   */
  async repararDeficit(deficitCajaChica: number, fondoFaltante: number): Promise<{ ok: boolean; turnoId?: string; errorMsg?: string }> {
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
      this.supabase.client.rpc('reparar_deficit_turno', {
        p_empleado_id: empleado.id,
        p_deficit_caja_chica: deficitCajaChica,
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
   * Obtiene el estado completo de la caja para mostrar en el banner
   */
  async obtenerEstadoCaja(): Promise<EstadoCaja> {
    const fechaHoy = getFechaLocal();
    const inicioDia = new Date(`${fechaHoy}T00:00:00`).toISOString();
    const finDia = new Date(`${fechaHoy}T23:59:59`).toISOString();

    const turnoActivo = await this.supabase.call<TurnoCajaConEmpleado>(
      this.supabase.client
        .from('turnos_caja')
        .select('*, empleado:usuarios(id, nombre)')
        .gte('hora_fecha_apertura', inicioDia)
        .is('hora_fecha_cierre', null)
        .maybeSingle(),
      undefined,
      { showLoading: false }
    );

    const { count } = await this.supabase.client
      .from('turnos_caja')
      .select('id', { count: 'exact', head: true })
      .gte('hora_fecha_apertura', inicioDia)
      .lte('hora_fecha_apertura', finDia);

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
