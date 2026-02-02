import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { SaldosAnteriores } from '../models/saldos-anteriores.model';

/**
 * Tipo de retorno de la query de saldo virtual
 */
interface SaldoVirtualQuery {
  saldo_virtual_actual: number;
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
}
