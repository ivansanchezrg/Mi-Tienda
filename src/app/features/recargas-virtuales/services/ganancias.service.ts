import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';

/**
 * Calcula ganancias BUS pendientes de liquidar para notificaciones.
 *
 * BUS: la ganancia está pendiente mientras pagado_proveedor=false.
 * Al liquidar, fn_liquidar_ganancias marca pagado_proveedor=true y
 * ganancia_liquidada=true en una sola operación atómica.
 *
 * CELULAR no se calcula aquí — su ganancia pendiente se filtra por
 * pagado_proveedor=true AND ganancia_liquidada=false, y se calcula
 * directamente en recargas-virtuales.page.ts desde los datos cargados.
 */
@Injectable({ providedIn: 'root' })
export class GananciasService {
  private supabase = inject(SupabaseService);

  private tiposBusIdCache: number | null = null;
  private tiposBusInFlight: Promise<number> | null = null;

  private getTipoBusId(): Promise<number> {
    if (this.tiposBusIdCache !== null) return Promise.resolve(this.tiposBusIdCache);
    if (this.tiposBusInFlight) return this.tiposBusInFlight;

    this.tiposBusInFlight = Promise.resolve(
      this.supabase.client.from('tipos_servicio').select('id').eq('codigo', 'BUS').single()
    ).then(res => {
      if (res.error) throw res.error;
      this.tiposBusIdCache = res.data.id as number;
      return res.data.id as number;
    }).finally(() => { this.tiposBusInFlight = null; });

    return this.tiposBusInFlight;
  }

  /**
   * Total de ganancia BUS pendiente de liquidar (filas con pagado_proveedor=false).
   * @returns Suma de ganancia o null si no hay nada pendiente.
   */
  async calcularGananciaBusPendiente(): Promise<number | null> {
    const tipoId = await this.getTipoBusId();

    const result = await this.supabase.call<Array<{ ganancia: number }>>(
      this.supabase.client
        .from('recargas_virtuales')
        .select('ganancia')
        .eq('tipo_servicio_id', tipoId)
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
   * de mes en notificaciones. La comisión se lee una vez de tipos_servicio.
   */
  async calcularGananciaBusMesActual(): Promise<number> {
    const inicioMes = this.formatMesPrimerDia(new Date());
    const finMes    = this.primerDiaSiguienteMes(new Date());
    const tipoId    = await this.getTipoBusId();

    const [comisionRes, comprasRes] = await Promise.all([
      this.supabase.client
        .from('tipos_servicio')
        .select('porcentaje_comision')
        .eq('id', tipoId)
        .single(),
      this.supabase.call<Array<{ monto_a_pagar: number }>>(
        this.supabase.client
          .from('recargas_virtuales')
          .select('monto_a_pagar')
          .eq('tipo_servicio_id', tipoId)
          .eq('pagado_proveedor', false)
          .gte('fecha', inicioMes)
          .lt('fecha', finMes)
      )
    ]);

    if (!comprasRes || comprasRes.length === 0) return 0;

    const comision     = comisionRes.data?.porcentaje_comision ?? 1;
    const totalCompras = comprasRes.reduce((sum, r) => sum + Number(r.monto_a_pagar), 0);
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
