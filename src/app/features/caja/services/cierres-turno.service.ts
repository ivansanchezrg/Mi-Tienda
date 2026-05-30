import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { CierreTurnoSnapshot } from '../models/cierre-turno.model';

@Injectable({ providedIn: 'root' })
export class CierresTurnoService {
  private supabase = inject(SupabaseService);

  /**
   * Lista los cierres de turno del rango (fechas locales YYYY-MM-DD).
   * Devuelve 1 fila por turno cerrado, más reciente primero.
   */
  async listar(fechaDesde: string, fechaHasta: string): Promise<CierreTurnoSnapshot[]> {
    const data = await this.supabase.call<CierreTurnoSnapshot[]>(
      this.supabase.client.rpc('fn_listar_cierres_turno', {
        p_fecha_desde: fechaDesde,
        p_fecha_hasta: fechaHasta,
      })
    );
    return data ?? [];
  }
}
