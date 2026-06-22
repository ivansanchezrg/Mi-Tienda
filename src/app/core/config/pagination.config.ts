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
  },
  /**
   * Historial de cierres de turno
   */
  historialTurnos: {
    pageSize: 20
  },
  /**
   * Historial de recargas (snapshots por cierre de turno)
   */
  historialRecargas: {
    pageSize: 20
  },
  /**
   * Historial de pagos de suscripción
   */
  historialPagosSuscripcion: {
    pageSize: 20
  }
} as const;
