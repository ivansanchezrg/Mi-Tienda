import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';

/**
 * Calcula ganancias BUS pendientes de liquidar para notificaciones.
 *
 * BUS nace con pagado_proveedor=true desde el INSERT (fn_registrar_compra_saldo_bus
 * v4.1+) — no tiene etapa de pago a proveedor, a diferencia de CELULAR. La ganancia
 * está pendiente de liquidar mientras ganancia_liquidada=false, sin importar
 * pagado_proveedor (mismo criterio que RecargasVirtualesService.obtenerPendientes()).
 * Al liquidar, fn_liquidar_ganancias marca ganancia_liquidada=true atómicamente.
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
   * Total de ganancia BUS pendiente de liquidar (filas con ganancia_liquidada=false).
   * @returns Suma de ganancia o null si no hay nada pendiente.
   */
  async calcularGananciaBusPendiente(): Promise<number | null> {
    const tipoId = await this.getTipoBusId();

    const result = await this.supabase.call<Array<{ ganancia: number }>>(
      this.supabase.client
        .from('recargas_virtuales')
        .select('ganancia')
        .eq('tipo_servicio_id', tipoId)
        .eq('ganancia_liquidada', false)
    );

    if (!result || result.length === 0) return null;

    const total = Math.round(
      result.reduce((sum, r) => sum + Number(r.ganancia), 0) * 100
    ) / 100;

    return total > 0 ? total : null;
  }

  /**
   * Ganancia BUS acumulada del mes en curso. Usada para el recordatorio de fin
   * de mes en notificaciones. La ganancia ya viene calculada y guardada por fila
   * (fn_registrar_compra_saldo_bus v4.1+) — se suma directo, sin recalcular con
   * el % de comisión actual (evita divergir si la comisión cambia después).
   */
  async calcularGananciaBusMesActual(): Promise<number> {
    const inicioMes = this.formatMesPrimerDia(new Date());
    const finMes    = this.primerDiaSiguienteMes(new Date());
    const tipoId    = await this.getTipoBusId();

    const result = await this.supabase.call<Array<{ ganancia: number }>>(
      this.supabase.client
        .from('recargas_virtuales')
        .select('ganancia')
        .eq('tipo_servicio_id', tipoId)
        .gte('fecha', inicioMes)
        .lt('fecha', finMes)
    );

    if (!result || result.length === 0) return 0;

    return Math.round(result.reduce((sum, r) => sum + Number(r.ganancia), 0) * 100) / 100;
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
