import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { LoggerService } from '@core/services/logger.service';
import { ParamsCierreDiario } from '../models/saldos-anteriores.model';
import { getFechaLocal, getInicioDiaSiguienteDeISO } from '@core/utils/date.util';

/**
 * Interface para historial de recargas
 */
export interface RecargaHistorial {
  id: string;
  fecha: string;
  servicio: string;
  saldo_anterior: number;
  saldo_actual: number;
  venta_dia: number;
  saldo_caja: number;
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
  private logger   = inject(LoggerService);

  /**
   * Verifica si el turno de hoy ya tiene un cierre registrado.
   * Usado desde el Home antes de navegar al wizard de cierre.
   * @returns true si ya fue cerrado, false si no, null si hay error
   */
  async existeCierreDiario(fecha?: string): Promise<boolean | null> {
    try {
      const fechaBusqueda = fecha || getFechaLocal();
      const inicioDia = new Date(`${fechaBusqueda}T00:00:00`).toISOString();
      const inicioMana = getInicioDiaSiguienteDeISO(fechaBusqueda);

      // Buscar el turno más reciente de hoy
      const turnoResponse = await this.supabase.client
        .from('turnos_caja')
        .select('id, hora_fecha_cierre')
        .gte('hora_fecha_apertura', inicioDia)
        .lt('hora_fecha_apertura', inicioMana)
        .order('hora_fecha_apertura', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (turnoResponse.error) {
        this.logger.error('RecargasService', 'Error al buscar turno (existeCierreDiario)', turnoResponse.error);
        return null;
      }

      // Sin turno hoy → no hay cierre
      if (!turnoResponse.data) return false;

      // Turno con hora_fecha_cierre → ya fue cerrado
      return turnoResponse.data.hora_fecha_cierre !== null;
    } catch (error: any) {
      this.logger.error('RecargasService', 'Excepción inesperada (existeCierreDiario)', error);
      return null;
    }
  }

  /** Ejecuta el cierre diario completo en una transacción atómica (fn_ejecutar_cierre_diario v6.3). */
  async ejecutarCierreDiario(params: ParamsCierreDiario): Promise<any> {
    const resultado = await this.supabase.call(
      this.supabase.client.rpc('fn_ejecutar_cierre_diario', {
        p_turno_id: params.turno_id,
        p_fecha: params.fecha,
        p_empleado_id: params.empleado_id,
        p_efectivo_fisico: params.efectivo_fisico,
        p_saldo_celular_final: params.saldo_celular_final,
        p_saldo_bus_final: params.saldo_bus_final,
        p_saldo_anterior_celular: params.saldo_anterior_celular,
        p_saldo_anterior_bus: params.saldo_anterior_bus,
        p_saldo_anterior_caja_celular: params.saldo_anterior_caja_celular,
        p_saldo_anterior_caja_bus: params.saldo_anterior_caja_bus,
        p_observaciones: params.observaciones || null
      }),
      undefined,
      { showLoading: true }
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
        saldo_caja,
        created_at,
        tipos_servicio!inner(codigo)
      `)
      .order('created_at', { ascending: false });

    if (response.error) {
      this.logger.error('RecargasService', 'Error al obtener historial', response.error);
      throw response.error;
    }

    const recargas: RecargaHistorial[] = (response.data || []).map((r: any) => ({
      id: r.id,
      fecha: r.fecha,
      servicio: r.tipos_servicio.codigo,
      saldo_anterior: r.saldo_virtual_anterior,
      saldo_actual: r.saldo_virtual_actual,
      venta_dia: r.venta_dia,
      saldo_caja: r.saldo_caja ?? 0,
      created_at: r.created_at
    }));

    return recargas;
  }


}
