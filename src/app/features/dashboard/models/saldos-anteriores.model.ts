/**
 * Saldos virtuales anteriores para el cierre diario
 */
export interface SaldosAnteriores {
  celular: number;
  bus: number;
}

/**
 * Datos completos necesarios para el cierre diario (v4.0)
 * Incluye saldos virtuales, saldos de cajas físicas y configuración
 */
export interface DatosCierreDiario {
  /** Saldos virtuales de celular y bus */
  saldosVirtuales: SaldosAnteriores;
  /** Saldo actual de CAJA (principal) */
  saldoCaja: number;
  /** Saldo actual de CAJA_CHICA */
  saldoCajaChica: number;
  /** Saldo actual de CAJA_CELULAR */
  saldoCajaCelular: number;
  /** Saldo actual de CAJA_BUS */
  saldoCajaBus: number;
  /** Fondo fijo diario (viene de configuración) */
  fondoFijo: number;
  /** Monto fijo de transferencia diaria a caja chica (viene de configuración) */
  transferenciaDiariaCajaChica: number;
}

/**
 * Parámetros para ejecutar el cierre diario (Versión 4.1)
 * Ultra-simplificado: solo efectivo_recaudado + recargas
 * Múltiples cierres por día: 1 cierre por turno
 */
export interface ParamsCierreDiario {
  turno_id: string; // UUID del turno que se está cerrando
  fecha: string;
  empleado_id: number;
  // Operaciones del día
  efectivo_recaudado: number; // ¡Solo este campo! Todo lo demás viene de config
  // Recargas
  saldo_celular_final: number;
  saldo_bus_final: number;
  saldo_anterior_celular: number;
  saldo_anterior_bus: number;
  // Saldos de cajas
  saldo_anterior_caja: number;
  saldo_anterior_caja_chica: number;
  saldo_anterior_caja_celular: number;
  saldo_anterior_caja_bus: number;
  // Opcional
  observaciones?: string;
}
