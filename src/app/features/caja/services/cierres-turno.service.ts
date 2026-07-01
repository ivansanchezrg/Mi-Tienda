import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { CierreTurnoSnapshot } from '../models/cierre-turno.model';
import { PAGINATION_CONFIG } from '@core/config/pagination.config';

@Injectable({ providedIn: 'root' })
export class CierresTurnoService {
  private supabase = inject(SupabaseService);
  private pageSize = PAGINATION_CONFIG.historialTurnos.pageSize;

  /**
   * Lista los cierres de turno del rango (fechas locales YYYY-MM-DD), paginado.
   * Devuelve 1 fila por turno cerrado, más reciente primero. El límite se aplica
   * en SQL antes de los JOINs a ventas/recargas — con el filtro "Todo" y mucho
   * historial, nunca se calcula ni transfiere más de una página a la vez.
   */
  async listar(fechaDesde: string, fechaHasta: string, page: number = 0): Promise<CierreTurnoSnapshot[]> {
    const data = await this.supabase.call<CierreTurnoSnapshot[]>(
      this.supabase.client.rpc('fn_listar_cierres_turno', {
        p_fecha_desde: fechaDesde,
        p_fecha_hasta: fechaHasta,
        p_limit: this.pageSize,
        p_offset: page * this.pageSize,
      })
    );
    return data ?? [];
  }
}
