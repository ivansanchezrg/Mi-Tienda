import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SupabaseService } from '@core/services/supabase.service';
import { getFechaLocal } from '@core/utils/date.util';
import {
  GrupoNegocio,
  GrupoResumenVentas,
  GrupoSucursalRanking,
  GrupoTopProductos,
} from '../models/grupo.model';

/** Alcance de la vista de Ventas: el negocio activo, o todas las sucursales del grupo. */
export type AlcanceVentas = 'este' | 'todas';

/**
 * Servicio de la Vista de grupo (Resumen general multi-sucursal).
 * Consume las funciones fn_grupo_* — todas resuelven la lista de negocios del
 * propietario internamente (SECURITY DEFINER); este servicio NUNCA envía
 * negocio_id. Es de solo lectura y no cambia el negocio activo del JWT.
 *
 * Además mantiene el ESTADO DE ALCANCE compartido entre las tabs de Ventas
 * (Listado y Resumen), para que al cambiar a "Todas las sucursales" en una tab,
 * la otra lo respete sin desincronizarse.
 */
@Injectable({ providedIn: 'root' })
export class GrupoService {
  private supabase = inject(SupabaseService);

  // ── Estado de alcance compartido (Listado ↔ Resumen) ──────────────────────
  private readonly _alcance$ = new BehaviorSubject<AlcanceVentas>('este');
  readonly alcance$ = this._alcance$.asObservable();
  get alcance(): AlcanceVentas { return this._alcance$.value; }
  setAlcance(a: AlcanceVentas): void {
    if (a !== this._alcance$.value) this._alcance$.next(a);
  }

  // ── Cache del gate multi-negocio (evita repetir la query en cada tab) ─────
  private _esPropietarioMulti: boolean | null = null;

  /**
   * True si el usuario es propietario de 2+ negocios (habilita el selector de
   * alcance). Cachea el resultado; se resetea con invalidarGate() al cambiar de
   * sesión/negocio.
   */
  async esPropietarioMultiNegocio(): Promise<boolean> {
    if (this._esPropietarioMulti !== null) return this._esPropietarioMulti;
    const negocios = await this.obtenerNegocios();
    this._esPropietarioMulti = negocios.length >= 2;
    return this._esPropietarioMulti;
  }

  /** Limpia el cache del gate y resetea el alcance (al cambiar de negocio/sesión). */
  invalidarGate(): void {
    this._esPropietarioMulti = null;
    this.setAlcance('este');
  }

  /**
   * Lista de negocios donde el usuario es propietario. Gate de la vista:
   * si length < 2 no hay nada que consolidar.
   */
  async obtenerNegocios(): Promise<GrupoNegocio[]> {
    return (await this.supabase.call<GrupoNegocio[]>(
      this.supabase.client.rpc('fn_grupo_negocios')
    )) ?? [];
  }

  /** Totales consolidados del grupo + comparativa período anterior. */
  async obtenerResumen(filtro: string): Promise<GrupoResumenVentas | null> {
    const { inicio, fin } = this.calcularRangoFiltro(filtro);
    return await this.supabase.call<GrupoResumenVentas>(
      this.supabase.client.rpc('fn_grupo_resumen_ventas', {
        p_fecha_inicio: inicio,
        p_fecha_fin:    fin,
      })
    );
  }

  /** Ranking de sucursales (ventas, ganancia, participación %, variación). */
  async obtenerRankingSucursales(filtro: string): Promise<GrupoSucursalRanking[]> {
    const { inicio, fin } = this.calcularRangoFiltro(filtro);
    return (await this.supabase.call<GrupoSucursalRanking[]>(
      this.supabase.client.rpc('fn_grupo_ventas_por_sucursal', {
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
