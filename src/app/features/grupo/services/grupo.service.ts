import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { getFechaLocal } from '@core/utils/date.util';
import {
  GrupoDashboard,
  GrupoVentasSeries,
  GrupoAlerta,
  GrupoTopProductos,
} from '../models/grupo.model';

/**
 * Servicio de la Vista de grupo (dashboard "Resumen general" multi-negocio,
 * plan MAX). Consume las funciones fn_grupo_* — todas resuelven la lista de
 * negocios del propietario internamente (SECURITY DEFINER); este servicio NUNCA
 * envía negocio_id. Es de solo lectura y no cambia el negocio activo del JWT.
 *
 * El gate de acceso (plan MAX + 2 negocios) vive en el SelectorNegocioModalComponent,
 * que reutiliza datos ya cargados (getMisNegocios + estadoSuscripcion) — este
 * servicio no participa del gate.
 */
@Injectable({ providedIn: 'root' })
export class GrupoService {
  private supabase = inject(SupabaseService);

  /**
   * Dashboard consolidado del grupo: KPIs + comparativa período anterior y la
   * tabla por negocio (ventas, clientes, ticket, unidades, ganancia,
   * participación %, variación, deuda fiado). Una sola RPC.
   */
  async obtenerDashboard(filtro: string): Promise<GrupoDashboard | null> {
    const { inicio, fin } = this.calcularRangoFiltro(filtro);
    return await this.supabase.call<GrupoDashboard>(
      this.supabase.client.rpc('fn_grupo_dashboard', {
        p_fecha_inicio: inicio,
        p_fecha_fin:    fin,
      })
    );
  }

  /** Serie temporal día×negocio para el gráfico de líneas (sin huecos). */
  async obtenerSeries(filtro: string): Promise<GrupoVentasSeries> {
    const { inicio, fin } = this.calcularRangoFiltro(filtro);
    return (await this.supabase.call<GrupoVentasSeries>(
      this.supabase.client.rpc('fn_grupo_ventas_series', {
        p_fecha_inicio: inicio,
        p_fecha_fin:    fin,
      })
    )) ?? { dias: [], series: [] };
  }

  /** Alertas accionables por negocio (sin ventas, cayendo, stock bajo). */
  async obtenerAlertas(filtro: string): Promise<GrupoAlerta[]> {
    const { inicio, fin } = this.calcularRangoFiltro(filtro);
    return (await this.supabase.call<GrupoAlerta[]>(
      this.supabase.client.rpc('fn_grupo_alertas', {
        p_fecha_inicio: inicio,
        p_fecha_fin:    fin,
      })
    )) ?? [];
  }

  /** Top productos del grupo (por ingreso y por ganancia). */
  async obtenerTopProductos(filtro: string): Promise<GrupoTopProductos> {
    const { inicio, fin } = this.calcularRangoFiltro(filtro);
    return (await this.supabase.call<GrupoTopProductos>(
      this.supabase.client.rpc('fn_grupo_top_productos', {
        p_fecha_inicio: inicio,
        p_fecha_fin:    fin,
      })
    )) ?? { top_ingreso: [], top_rentables: [] };
  }

  /**
   * Traduce el filtro de período a un rango [inicio, fin] de fechas locales.
   * Mismo criterio que VentasService.calcularRangoFiltro (semana = lunes→hoy,
   * mes = día 1→hoy, etc.) para que la vista de grupo sea coherente con la de
   * cada negocio individual.
   */
  private calcularRangoFiltro(filtro: string): { inicio: string; fin: string } {
    const hoy = getFechaLocal();
    const fecha = new Date(hoy + 'T00:00:00');

    if (filtro === 'semana') {
      const lunes = new Date(fecha);
      lunes.setDate(fecha.getDate() - fecha.getDay() + (fecha.getDay() === 0 ? -6 : 1));
      const lunesLocal = `${lunes.getFullYear()}-${String(lunes.getMonth() + 1).padStart(2, '0')}-${String(lunes.getDate()).padStart(2, '0')}`;
      return { inicio: lunesLocal, fin: hoy };
    }

    if (filtro === 'mes') {
      return { inicio: `${hoy.slice(0, 7)}-01`, fin: hoy };
    }

    if (filtro === 'anio') {
      return { inicio: `${hoy.slice(0, 4)}-01-01`, fin: hoy };
    }

    if (filtro === 'todo') {
      return { inicio: '2000-01-01', fin: hoy };
    }

    // 'hoy' por defecto
    return { inicio: hoy, fin: hoy };
  }
}
