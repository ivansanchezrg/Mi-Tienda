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
  },
  /**
   * Cuentas por cobrar (fiados)
   */
  cuentasCobrar: {
    pageSize: 20
  },
  /**
   * Clientes
   */
  clientes: {
    pageSize: 25
  },
  /**
   * Notas compartidas
   */
  notas: {
    pageSize: 30
  },
  /**
   * Movimientos de empleados (cuenta corriente)
   */
  movimientosEmpleados: {
    pageSize: 20
  }
} as const;
