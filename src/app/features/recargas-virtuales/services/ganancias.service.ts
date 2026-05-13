import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';

/**
 * Servicio para calcular ganancias pendientes de liquidar.
 *
 * Tanto CELULAR como BUS funcionan igual: la ganancia está pendiente mientras
 * pagado_proveedor=false. Al liquidar se marca pagado_proveedor=true y
 * ganancia_liquidada=true en la misma operación atómica.
 */
@Injectable({ providedIn: 'root' })
export class GananciasService {
  private supabase = inject(SupabaseService);

  /**
   * Total de ganancia BUS pendiente de liquidar (filas con pagado_proveedor=false).
   * @returns Suma de ganancia o null si no hay nada pendiente.
   */
  async calcularGananciaBusPendiente(): Promise<number | null> {
    const result = await this.supabase.call<Array<{ ganancia: number }>>(
      this.supabase.client
        .from('recargas_virtuales')
        .select('ganancia, tipos_servicio!inner(codigo)')
        .eq('tipos_servicio.codigo', 'BUS')
        .eq('pagado_proveedor', false)
    );

    if (!result || result.length === 0) return null;

    const total = Math.round(
      result.reduce((sum, r) => sum + Number(r.ganancia), 0) * 100
    ) / 100;

    return total > 0 ? total : null;
  }

  /**
   * Ganancia BUS acumulada del mes en curso. Usada para el recordatorio de fin
   * de mes en notificaciones.
   */
  async calcularGananciaBusMesActual(): Promise<number> {
    const inicioMes = this.formatMesPrimerDia(new Date());
    const finMes = this.primerDiaSiguienteMes(new Date());

    const result = await this.supabase.call<Array<{
      monto_a_pagar: number;
      tipos_servicio: { porcentaje_comision: number };
    }>>(
      this.supabase.client
        .from('recargas_virtuales')
        .select('monto_a_pagar, tipos_servicio!inner(codigo, porcentaje_comision)')
        .eq('tipos_servicio.codigo', 'BUS')
        .eq('pagado_proveedor', false)
        .gte('fecha', inicioMes)
        .lt('fecha', finMes)
    );

    if (!result || result.length === 0) return 0;
    const comision = (result[0] as any).tipos_servicio?.porcentaje_comision ?? 1;
    const totalCompras = result.reduce((sum, r) => sum + Number(r.monto_a_pagar), 0);
    return Math.round(totalCompras * (comision / 100) * 100) / 100;
  }

  private formatMesPrimerDia(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01`;
  }

  private primerDiaSiguienteMes(d: Date): string {
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return this.formatMesPrimerDia(next);
  }
}
