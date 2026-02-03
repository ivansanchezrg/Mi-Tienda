import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { SaldosAnteriores, DatosCierreDiario } from '../models/saldos-anteriores.model';

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
 * Servicio para gestionar operaciones de recargas (Celular y Bus)
 */
@Injectable({
  providedIn: 'root'
})
export class RecargasService {
  private supabase = inject(SupabaseService);

  /**
   * Obtiene la fecha actual en formato YYYY-MM-DD en zona horaria local
   * (Evita problemas de zona horaria con toISOString)
   * @returns {string} Fecha local en formato YYYY-MM-DD
   */
  getFechaLocal(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Obtiene los saldos virtuales anteriores (últimos registros) de Celular y Bus
   *
   * Según proceso_recargas.md:
   * - El saldo_virtual_actual del último registro ES el saldo_virtual_anterior para el cierre actual
   *
   * @returns Saldos anteriores de Celular y Bus (0 si no hay registros previos)
   */
  async getSaldosAnteriores(): Promise<SaldosAnteriores> {
    // Queries en paralelo para mejor performance
    const [celular, bus] = await Promise.all([
      // Último saldo Celular
      this.supabase.call<SaldoVirtualQuery>(
        this.supabase.client
          .from('recargas')
          .select('saldo_virtual_actual, tipos_servicio!inner(codigo)')
          .eq('tipos_servicio.codigo', 'CELULAR')
          .order('fecha', { ascending: false })
          .limit(1)
          .maybeSingle()
      ),
      // Último saldo Bus
      this.supabase.call<SaldoVirtualQuery>(
        this.supabase.client
          .from('recargas')
          .select('saldo_virtual_actual, tipos_servicio!inner(codigo)')
          .eq('tipos_servicio.codigo', 'BUS')
          .order('fecha', { ascending: false })
          .limit(1)
          .maybeSingle()
      )
    ]);

    return {
      celular: celular?.saldo_virtual_actual ?? 0,
      bus: bus?.saldo_virtual_actual ?? 0
    };
  }

  /**
   * Obtiene todos los datos necesarios para el cierre diario
   *
   * Realiza queries en paralelo para obtener:
   * - Saldos virtuales anteriores (Celular y Bus) desde tabla recargas
   * - Saldos actuales de las 4 cajas desde tabla cajas
   * - Configuración de transferencia diaria desde tabla configuraciones
   *
   * @returns {Promise<DatosCierreDiario>} Objeto con todos los datos necesarios para el cierre
   *
   * @example
   * const datos = await recargasService.getDatosCierreDiario();
   * console.log(datos.saldoCaja); // 500.00
   * console.log(datos.transferenciaDiariaCajaChica); // 20.00
   */
  async getDatosCierreDiario(): Promise<DatosCierreDiario> {
    // Queries en paralelo para mejor performance
    const [saldosVirtuales, caja, cajaChica, cajaCelular, cajaBus, config] = await Promise.all([
      // 1. Saldos virtuales (Celular y Bus)
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

      // 6. Configuración de transferencia diaria
      this.supabase.call<ConfiguracionQuery>(
        this.supabase.client
          .from('configuraciones')
          .select('caja_chica_transferencia_diaria')
          .limit(1)
          .single()
      )
    ]);

    return {
      saldosVirtuales,
      saldoCaja: caja?.saldo_actual ?? 0,
      saldoCajaChica: cajaChica?.saldo_actual ?? 0,
      saldoCajaCelular: cajaCelular?.saldo_actual ?? 0,
      saldoCajaBus: cajaBus?.saldo_actual ?? 0,
      transferenciaDiariaCajaChica: config?.caja_chica_transferencia_diaria ?? 20
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
   * Obtiene el empleado actual desde la sesión de Supabase
   * @returns {Promise<any>} Datos del empleado o null
   */
  async obtenerEmpleadoActual(): Promise<any> {
    const { data: { user } } = await this.supabase.client.auth.getUser();
    if (!user?.email) return null;

    const empleado = await this.supabase.call<{ id: number; nombre: string }>(
      this.supabase.client
        .from('empleados')
        .select('id, nombre')
        .eq('usuario', user.email)
        .single()
    );

    return empleado;
  }

  /**
   * Verifica si ya existe un cierre diario para la fecha actual (local)
   * Si no se pasa fecha, usa la fecha local actual
   * @param {string} [fecha] Fecha en formato YYYY-MM-DD (opcional)
   * @returns {Promise<boolean>} True si ya existe un cierre para esa fecha
   */
  async existeCierreDiario(fecha?: string): Promise<boolean> {
    const fechaBusqueda = fecha || this.getFechaLocal();

    const recarga = await this.supabase.call<{ id: string }>(
      this.supabase.client
        .from('recargas')
        .select('id')
        .eq('fecha', fechaBusqueda)
        .limit(1)
        .maybeSingle()
    );

    return recarga !== null;
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
   * Ejecuta el cierre diario completo usando función PostgreSQL
   *
   * Esta función ejecuta todas las operaciones del cierre diario en una transacción atómica.
   * Si alguna operación falla, PostgreSQL hace rollback automático de todo.
   *
   * @param {object} params Parámetros del cierre diario
   * @param {string} params.fecha Fecha del cierre (YYYY-MM-DD)
   * @param {number} params.empleado_id ID del empleado
   * @param {number} params.saldo_celular_final Saldo virtual final de celular
   * @param {number} params.saldo_bus_final Saldo virtual final de bus
   * @param {number} params.efectivo_recaudado Efectivo total recaudado
   * @param {number} params.saldo_anterior_celular Saldo virtual anterior de celular
   * @param {number} params.saldo_anterior_bus Saldo virtual anterior de bus
   * @param {number} params.saldo_anterior_caja Saldo anterior de CAJA
   * @param {number} params.saldo_anterior_caja_chica Saldo anterior de CAJA_CHICA
   * @param {number} params.saldo_anterior_caja_celular Saldo anterior de CAJA_CELULAR
   * @param {number} params.saldo_anterior_caja_bus Saldo anterior de CAJA_BUS
   * @param {string} [params.observaciones] Observaciones opcionales
   * @returns {Promise<any>} Resultado del cierre con información detallada
   */
  async ejecutarCierreDiario(params: {
    fecha: string;
    empleado_id: number;
    saldo_celular_final: number;
    saldo_bus_final: number;
    efectivo_recaudado: number;
    saldo_anterior_celular: number;
    saldo_anterior_bus: number;
    saldo_anterior_caja: number;
    saldo_anterior_caja_chica: number;
    saldo_anterior_caja_celular: number;
    saldo_anterior_caja_bus: number;
    observaciones?: string;
  }): Promise<any> {
    const resultado = await this.supabase.call(
      this.supabase.client.rpc('ejecutar_cierre_diario', {
        p_fecha: params.fecha,
        p_empleado_id: params.empleado_id,
        p_saldo_celular_final: params.saldo_celular_final,
        p_saldo_bus_final: params.saldo_bus_final,
        p_efectivo_recaudado: params.efectivo_recaudado,
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
}
