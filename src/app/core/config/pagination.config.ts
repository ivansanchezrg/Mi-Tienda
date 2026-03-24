/**
 * Configuración de paginación para el sistema
 */
export const PAGINATION_CONFIG = {
  /**
   * Operaciones de caja
   */
  operacionesCaja: {
    pageSize: 20
  },
  /**
   * Catálogo de productos (inventario)
   */
  inventario: {
    pageSize: 25
  },
  /**
   * Historial de ventas
   */
  ventas: {
    pageSize: 25
  }
} as const;
