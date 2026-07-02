/**
 * Modelos de la Vista de grupo (Resumen general multi-sucursal).
 * Reflejan el contrato de las funciones fn_grupo_* del backend.
 */

/** Un negocio del propietario (fn_grupo_negocios). */
export interface GrupoNegocio {
  negocio_id: string;
  nombre: string;
  slug: string;
}

/** Totales consolidados del grupo + comparativa período anterior (fn_grupo_resumen_ventas). */
export interface GrupoResumenVentas {
  fecha_inicio: string;
  fecha_fin: string;
  total_negocios: number;
  total_ventas: number;
  total_monto: number;
  total_anuladas: number;
  monto_anulado: number;
  total_descuentos: number;
  clientes_unicos: number;
  costo_total: number;
  ganancia_bruta: number;
  margen_pct: number;
  ticket_promedio: number;
  total_monto_anterior: number;
  total_ventas_anterior: number;
  ganancia_anterior: number;
}

/** Una fila del ranking de sucursales (fn_grupo_ventas_por_sucursal). */
export interface GrupoSucursalRanking {
  negocio_id: string;
  nombre: string;
  total_ventas: number;
  total_monto: number;
  ganancia_bruta: number;
  ticket_promedio: number;
  /** % del monto total del grupo */
  participacion_pct: number;
  total_monto_anterior: number;
  /** Variación vs período anterior (+/-). null si no había base para comparar. */
  variacion_pct: number | null;
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
