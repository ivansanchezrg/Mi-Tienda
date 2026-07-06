/**
 * Modelos del dashboard "Resumen general" multi-negocio (plan MAX).
 * Reflejan el contrato de las funciones fn_grupo_* del backend.
 */

// ── fn_grupo_dashboard ──────────────────────────────────────────────────────

/** KPIs consolidados del grupo + comparativa período anterior (bloque `grupo`). */
export interface GrupoDashboardKpis {
  total_negocios: number;
  total_ventas: number;
  total_monto: number;
  total_anuladas: number;
  monto_anulado: number;
  total_descuentos: number;
  clientes_unicos: number;
  unidades_vendidas: number;
  costo_total: number;
  ganancia_bruta: number;
  margen_pct: number;
  ticket_promedio: number;
  /** Deuda fiado por cobrar del grupo — snapshot actual, no acotada al período. */
  deuda_fiado: number;
  total_monto_anterior: number;
  total_ventas_anterior: number;
  ganancia_anterior: number;
}

/** Una fila de la tabla por negocio (bloque `negocios`; también alimenta el donut). */
export interface GrupoDashboardNegocio {
  negocio_id: string;
  nombre: string;
  total_ventas: number;
  total_monto: number;
  clientes_unicos: number;
  unidades_vendidas: number;
  ganancia_bruta: number;
  ticket_promedio: number;
  /** % del monto total del grupo (donut de participación). */
  participacion_pct: number;
  total_monto_anterior: number;
  /** Variación vs período anterior (+/-). null si no había base para comparar. */
  variacion_pct: number | null;
  /** Deuda fiado del negocio — snapshot actual, no acotada al período. */
  deuda_fiado: number;
}

/** Respuesta consolidada de fn_grupo_dashboard. */
export interface GrupoDashboard {
  fecha_inicio: string;
  fecha_fin: string;
  grupo: GrupoDashboardKpis;
  negocios: GrupoDashboardNegocio[];
}

// ── fn_grupo_ventas_series ──────────────────────────────────────────────────

/** Una línea del gráfico temporal: sus valores alinean por posición con `dias`. */
export interface GrupoVentasSerie {
  negocio_id: string;
  nombre: string;
  /** monto vendido por día; valores[i] corresponde a dias[i]. */
  valores: number[];
}

/** Serie temporal para el gráfico de líneas (fn_grupo_ventas_series). */
export interface GrupoVentasSeries {
  /** eje X — fechas locales 'YYYY-MM-DD' en orden. */
  dias: string[];
  series: GrupoVentasSerie[];
}

// ── fn_grupo_alertas ────────────────────────────────────────────────────────

/** Tipo de alerta accionable por negocio. */
export type GrupoAlertaTipo = 'SIN_VENTAS' | 'CAYENDO' | 'STOCK_BAJO';

/** Una alerta accionable (fn_grupo_alertas). */
export interface GrupoAlerta {
  tipo: GrupoAlertaTipo;
  negocio_id: string;
  nombre: string;
  /** % de caída (CAYENDO) · # de productos bajo mínimo (STOCK_BAJO) · 0 (SIN_VENTAS). */
  valor: number;
}

/** Un producto top del grupo (fn_grupo_top_productos). */
export interface GrupoTopProducto {
  nombre: string;
  total_unidades: number;
  /** presente en top_ingreso */
  total_monto?: number;
  /** presente en top_rentables */
  ganancia?: number;
  margen_pct?: number;
  /** en cuántas sucursales se vendió */
  sucursales: number;
}

export interface GrupoTopProductos {
  top_ingreso: GrupoTopProducto[];
  top_rentables: GrupoTopProducto[];
}
