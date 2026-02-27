import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { SaldosAnteriores, DatosCierreDiario, ParamsCierreDiario } from '../models/saldos-anteriores.model';
import { RecargasVirtualesService } from '@core/services/recargas-virtuales.service';
import { getFechaLocal } from '@core/utils/date.util';
import { AuthService } from '../../auth/services/auth.service';
import { EmpleadoActual } from '../../auth/models/empleado_actual.model';

/**
 * Tipo de retorno de la query de saldo virtual
 */
interface SaldoVirtualQuery {
  saldo_virtual_actual: number;
}

/**
 * Tipo de retorno de la query de cajas
 */
interface CajaQuery {
  saldo_actual: number;
}

/**
 * Tipo de retorno de la query de configuraciones
 */
interface ConfiguracionQuery {
  caja_chica_transferencia_diaria: number;
}

/**
 * Tipo de retorno para IDs de tipos de servicio
 */
interface TiposServicioIds {
  celular: number;
  bus: number;
}

/**
 * Tipo de retorno para IDs de cajas
 */
interface CajasIds {
  caja: number;
  cajaChica: number;
  cajaCelular: number;
  cajaBus: number;
}

/**
 * Interface para historial de recargas
 */
export interface RecargaHistorial {
  id: number;
  fecha: string;
  servicio: string;
  saldo_anterior: number;
  saldo_actual: number;
  venta_dia: number;
  created_at: string;
}

/**
 * Servicio para gestionar operaciones de recargas (Celular y Bus)
 */
@Injectable({
  providedIn: 'root'
})
export class RecargasService {
  private supabase = inject(SupabaseService);
  private recargasVirtualesService = inject(RecargasVirtualesService);
  private authService = inject(AuthService);

  /**
   * Obtiene los saldos virtuales anteriores (últimos registros) de Celular y Bus
   *
   * v4.1: Con múltiples cierres por día, ordenamos por created_at para tomar
   * el registro MÁS RECIENTE cronológicamente (sin importar cuántos turnos haya en el día)
   *
   * @returns Saldos anteriores de Celular y Bus (0 si no hay registros previos)
   */
  async getSaldosAnteriores(): Promise<SaldosAnteriores> {
    // Queries en paralelo para mejor performance
    const [celular, bus] = await Promise.all([
      // Último saldo Celular (ordenado por created_at DESC)
      this.supabase.call<SaldoVirtualQuery>(
        this.supabase.client
          .from('recargas')
          .select('saldo_virtual_actual, tipos_servicio!inner(codigo)')
          .eq('tipos_servicio.codigo', 'CELULAR')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      ),
      // Último saldo Bus (ordenado por created_at DESC)
      this.supabase.call<SaldoVirtualQuery>(
        this.supabase.client
          .from('recargas')
          .select('saldo_virtual_actual, tipos_servicio!inner(codigo)')
          .eq('tipos_servicio.codigo', 'BUS')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      )
    ]);

    // Sin cierre previo → saldo anterior es 0. agregadoHoy ya cubre el balance actual.
    return {
      celular: celular?.saldo_virtual_actual ?? 0,
      bus: bus?.saldo_virtual_actual ?? 0
    };
  }

  /**
   * Obtiene el monto total de recargas virtuales NO INCORPORADAS en cierres previos (v4.5 CORREGIDO)
   *
   * CRÍTICO: Filtra por created_at > último_cierre_at (NO por fecha = hoy)
   * Esto captura recargas pendientes sin importar su fecha de registro.
   *
   * Ejemplo: recarga del 21/02 puede aplicarse en cierre del 23/02 si no hubo cierre el 22/02
   *
   * @returns {Promise<{ celular: number; bus: number }>} Montos pendientes de cada servicio
   */
  async getAgregadoVirtualHoy(): Promise<{ celular: number; bus: number }> {
    // 1. Obtener created_at del último cierre de cada servicio
    const [ultimoCierreCelular, ultimoCierreBus] = await Promise.all([
      this.supabase.client
        .from('recargas')
        .select('created_at, tipos_servicio!inner(codigo)')
        .eq('tipos_servicio.codigo', 'CELULAR')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.supabase.client
        .from('recargas')
        .select('created_at, tipos_servicio!inner(codigo)')
        .eq('tipos_servicio.codigo', 'BUS')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);

    if (ultimoCierreCelular.error) throw new Error(`Error al obtener último cierre celular: ${ultimoCierreCelular.error.message}`);
    if (ultimoCierreBus.error) throw new Error(`Error al obtener último cierre bus: ${ultimoCierreBus.error.message}`);

    const ultimoCierreAtCelular = ultimoCierreCelular.data?.created_at;
    const ultimoCierreAtBus = ultimoCierreBus.data?.created_at;

    // 2. Filtrar por created_at > último cierre (NO por fecha = hoy)
    let queryCelular = this.supabase.client
      .from('recargas_virtuales')
      .select('monto_virtual, tipos_servicio!inner(codigo)')
      .eq('tipos_servicio.codigo', 'CELULAR');

    if (ultimoCierreAtCelular) {
      queryCelular = queryCelular.gt('created_at', ultimoCierreAtCelular);
    }

    let queryBus = this.supabase.client
      .from('recargas_virtuales')
      .select('monto_virtual, tipos_servicio!inner(codigo)')
      .eq('tipos_servicio.codigo', 'BUS');

    if (ultimoCierreAtBus) {
      queryBus = queryBus.gt('created_at', ultimoCierreAtBus);
    }

    const [celularRes, busRes] = await Promise.all([queryCelular, queryBus]);

    // Sumar los montos en TypeScript
    const celular = (celularRes.data || []).reduce((sum: number, r: any) => sum + (r.monto_virtual || 0), 0);
    const bus = (busRes.data || []).reduce((sum: number, r: any) => sum + (r.monto_virtual || 0), 0);

    return { celular, bus };
  }

  /**
   * Obtiene todos los datos necesarios para el cierre diario (v4.5)
   *
   * Realiza queries en paralelo para obtener:
   * - Saldos virtuales anteriores (Celular y Bus) desde tabla recargas
   * - Saldos actuales de las 4 cajas desde tabla cajas
   * - Configuración (fondo_fijo y transferencia_diaria) desde tabla configuraciones
   * - Agregado hoy desde recargas_virtuales (v4.5)
   *
   * @returns {Promise<DatosCierreDiario>} Objeto con todos los datos necesarios para el cierre
   *
   * @example
   * const datos = await recargasService.getDatosCierreDiario();
   * console.log(datos.fondoFijo); // 40.00
   * console.log(datos.transferenciaDiariaCajaChica); // 20.00
   */
  async getDatosCierreDiario(): Promise<DatosCierreDiario> {
    // Queries en paralelo para mejor performance
    const [saldosVirtuales, caja, cajaChica, cajaCelular, cajaBus, config, agregadoHoy] = await Promise.all([
      // 1. Saldos virtuales anteriores (último saldo_virtual_actual de tabla recargas)
      this.getSaldosAnteriores(),

      // 2. Saldo actual de CAJA (principal)
      this.supabase.call<CajaQuery>(
        this.supabase.client
          .from('cajas')
          .select('saldo_actual')
          .eq('codigo', 'CAJA')
          .single()
      ),

      // 3. Saldo actual de CAJA_CHICA
      this.supabase.call<CajaQuery>(
        this.supabase.client
          .from('cajas')
          .select('saldo_actual')
          .eq('codigo', 'CAJA_CHICA')
          .single()
      ),

      // 4. Saldo actual de CAJA_CELULAR
      this.supabase.call<CajaQuery>(
        this.supabase.client
          .from('cajas')
          .select('saldo_actual')
          .eq('codigo', 'CAJA_CELULAR')
          .single()
      ),

      // 5. Saldo actual de CAJA_BUS
      this.supabase.call<CajaQuery>(
        this.supabase.client
          .from('cajas')
          .select('saldo_actual')
          .eq('codigo', 'CAJA_BUS')
          .single()
      ),

      // 6. Configuración (fondo_fijo y transferencia_diaria)
      this.supabase.call<{ fondo_fijo_diario: number; caja_chica_transferencia_diaria: number }>(
        this.supabase.client
          .from('configuraciones')
          .select('fondo_fijo_diario, caja_chica_transferencia_diaria')
          .limit(1)
          .single()
      ),

      // 7. Agregado hoy de recargas virtuales (v4.5)
      this.getAgregadoVirtualHoy()
    ]);

    return {
      saldosVirtuales,
      saldoCaja: caja?.saldo_actual ?? 0,
      saldoCajaChica: cajaChica?.saldo_actual ?? 0,
      saldoCajaCelular: cajaCelular?.saldo_actual ?? 0,
      saldoCajaBus: cajaBus?.saldo_actual ?? 0,
      fondoFijo: config?.fondo_fijo_diario ?? 40,
      transferenciaDiariaCajaChica: config?.caja_chica_transferencia_diaria ?? 20,
      agregadoCelularHoy: agregadoHoy.celular,
      agregadoBusHoy: agregadoHoy.bus
    };
  }

  /**
   * Obtiene los IDs de los tipos de servicio (CELULAR y BUS)
   * @returns {Promise<TiposServicioIds>} IDs de celular y bus
   */
  async obtenerIdsTiposServicio(): Promise<TiposServicioIds> {
    const [celular, bus] = await Promise.all([
      this.supabase.call<{ id: number }>(
        this.supabase.client
          .from('tipos_servicio')
          .select('id')
          .eq('codigo', 'CELULAR')
          .single()
      ),
      this.supabase.call<{ id: number }>(
        this.supabase.client
          .from('tipos_servicio')
          .select('id')
          .eq('codigo', 'BUS')
          .single()
      )
    ]);

    return {
      celular: celular?.id ?? 0,
      bus: bus?.id ?? 0
    };
  }

  /**
   * Obtiene los IDs de las 4 cajas del sistema
   * @returns {Promise<CajasIds>} IDs de las cajas
   */
  async obtenerIdsCajas(): Promise<CajasIds> {
    const [caja, cajaChica, cajaCelular, cajaBus] = await Promise.all([
      this.supabase.call<{ id: number }>(
        this.supabase.client
          .from('cajas')
          .select('id')
          .eq('codigo', 'CAJA')
          .single()
      ),
      this.supabase.call<{ id: number }>(
        this.supabase.client
          .from('cajas')
          .select('id')
          .eq('codigo', 'CAJA_CHICA')
          .single()
      ),
      this.supabase.call<{ id: number }>(
        this.supabase.client
          .from('cajas')
          .select('id')
          .eq('codigo', 'CAJA_CELULAR')
          .single()
      ),
      this.supabase.call<{ id: number }>(
        this.supabase.client
          .from('cajas')
          .select('id')
          .eq('codigo', 'CAJA_BUS')
          .single()
      )
    ]);

    return {
      caja: caja?.id ?? 0,
      cajaChica: cajaChica?.id ?? 0,
      cajaCelular: cajaCelular?.id ?? 0,
      cajaBus: cajaBus?.id ?? 0
    };
  }

  /**
   * Obtiene el empleado actual desde Preferences (lectura local, sin red).
   * Delega a AuthService para evitar duplicar lógica y reducir queries a Supabase.
   * @returns {Promise<EmpleadoActual | null>} Datos del empleado o null
   */
  async obtenerEmpleadoActual(): Promise<EmpleadoActual | null> {
    return this.authService.getEmpleadoActual();
  }

  /**
   * Verifica si el turno activo ya tiene un cierre registrado (v4.1)
   * En v4.1: Permite múltiples cierres por día (1 por turno)
   *
   * @returns true si el turno activo tiene cierre, false si no, null si hay error
   */
  async existeCierreDiario(fecha?: string): Promise<boolean | null> {
    try {
      const fechaBusqueda = fecha || getFechaLocal();

      // 1. Obtener turno activo de hoy (sin hora_cierre)
      const turnoResponse = await this.supabase.client
        .from('turnos_caja')
        .select('id')
        .eq('fecha', fechaBusqueda)
        .is('hora_cierre', null)
        .maybeSingle();

      // Si hay error al buscar turno
      if (turnoResponse.error) {
        console.error('Error al verificar turno activo:', turnoResponse.error);
        return null;
      }

      // Si no hay turno activo, no hay cierre pendiente
      if (!turnoResponse.data) {
        return false;
      }

      // 2. Verificar si ese turno tiene cierre
      const cierreResponse = await this.supabase.client
        .from('caja_fisica_diaria')
        .select('id')
        .eq('turno_id', turnoResponse.data.id)
        .maybeSingle();

      // Si hay error al buscar cierre
      if (cierreResponse.error) {
        console.error('Error al verificar cierre del turno:', cierreResponse.error);
        return null;
      }

      // Retorna true si el turno activo ya tiene cierre
      return cierreResponse.data !== null;
    } catch (error) {
      console.error('Error en existeCierreDiario:', error);
      return null;
    }
  }

  /**
   * Guarda un registro de recarga en la base de datos
   * @param {any} recarga Datos de la recarga a guardar
   */
  async guardarRecarga(recarga: any): Promise<void> {
    await this.supabase.call(
      this.supabase.client
        .from('recargas')
        .insert(recarga)
    );
  }

  /**
   * Registra una operación en la tabla operaciones_cajas
   * @param {any} operacion Datos de la operación a registrar
   */
  async registrarOperacionCaja(operacion: any): Promise<void> {
    await this.supabase.call(
      this.supabase.client
        .from('operaciones_cajas')
        .insert(operacion)
    );
  }

  /**
   * Actualiza el saldo actual de una caja
   * @param {number} cajaId ID de la caja
   * @param {number} nuevoSaldo Nuevo saldo actual
   */
  async actualizarSaldoCaja(cajaId: number, nuevoSaldo: number): Promise<void> {
    await this.supabase.call(
      this.supabase.client
        .from('cajas')
        .update({ saldo_actual: nuevoSaldo, updated_at: new Date().toISOString() })
        .eq('id', cajaId)
    );
  }

  /**
   * Ejecuta el cierre diario completo usando función PostgreSQL (Versión 4.0)
   *
   * Esta función ejecuta todas las operaciones del cierre diario en una transacción atómica.
   * Si alguna operación falla, PostgreSQL hace rollback automático de todo.
   *
   * CAMBIOS VERSIÓN 4.0:
   * - Ultra-simplificado: Solo requiere efectivo_recaudado
   * - Fondo fijo y transferencia vienen de configuración
   * - Fórmula: depósito = efectivo_recaudado - fondo_fijo - transferencia
   *
   * @param {ParamsCierreDiario} params Parámetros completos del cierre diario
   * @returns {Promise<any>} Resultado del cierre con información detallada
   */
  /**
   * Verifica si ya se realizó la transferencia diaria a CAJA_CHICA hoy (v4.7)
   * Usa timezone local para evitar desfase UTC en cierres nocturnos.
   * @returns {Promise<boolean>} true si ya existe TRANSFERENCIA_ENTRANTE en CAJA_CHICA para la fecha local de hoy
   */
  async verificarTransferenciaYaHecha(): Promise<boolean> {
    const fechaHoy = getFechaLocal();
    const { data, error } = await this.supabase.client
      .rpc('verificar_transferencia_caja_chica_hoy', { p_fecha: fechaHoy });
    if (error || data === null) return false;
    return data as boolean;
  }

  async ejecutarCierreDiario(params: ParamsCierreDiario): Promise<any> {
    const resultado = await this.supabase.call(
      this.supabase.client.rpc('ejecutar_cierre_diario', {
        p_turno_id: params.turno_id,
        p_fecha: params.fecha,
        p_empleado_id: params.empleado_id,
        p_efectivo_recaudado: params.efectivo_recaudado,
        p_saldo_celular_final: params.saldo_celular_final,
        p_saldo_bus_final: params.saldo_bus_final,
        p_saldo_anterior_celular: params.saldo_anterior_celular,
        p_saldo_anterior_bus: params.saldo_anterior_bus,
        p_saldo_anterior_caja: params.saldo_anterior_caja,
        p_saldo_anterior_caja_chica: params.saldo_anterior_caja_chica,
        p_saldo_anterior_caja_celular: params.saldo_anterior_caja_celular,
        p_saldo_anterior_caja_bus: params.saldo_anterior_caja_bus,
        p_observaciones: params.observaciones || null
      })
    );

    return resultado;
  }

  /**
   * Obtiene el historial completo de recargas ordenado del más reciente al más antiguo.
   * Usa el campo venta_dia almacenado en la BD (calculado por la función SQL ejecutar_cierre_diario),
   * que ya descuenta correctamente las recargas del proveedor (recargas_virtuales).
   *
   * @returns {Promise<RecargaHistorial[]>} Lista de recargas con toda la información
   */
  async obtenerHistorialRecargas(): Promise<RecargaHistorial[]> {
    const response = await this.supabase.client
      .from('recargas')
      .select(`
        id,
        fecha,
        saldo_virtual_anterior,
        saldo_virtual_actual,
        venta_dia,
        created_at,
        tipos_servicio!inner(codigo)
      `)
      .order('created_at', { ascending: false });

    if (response.error) {
      console.error('Error al obtener historial:', response.error);
      throw response.error;
    }

    // Usar venta_dia guardado en BD — NO recalcular (evita negativos por recargas del proveedor)
    const recargas: RecargaHistorial[] = (response.data || []).map((r: any) => ({
      id: r.id,
      fecha: r.fecha,
      servicio: r.tipos_servicio.codigo,
      saldo_anterior: r.saldo_virtual_anterior,
      saldo_actual: r.saldo_virtual_actual,
      venta_dia: r.venta_dia,
      created_at: r.created_at
    }));

    return recargas;
  }


}
