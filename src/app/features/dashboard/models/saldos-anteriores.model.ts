/**
 * Saldos virtuales anteriores para el cierre diario
 */
export interface SaldosAnteriores {
  celular: number;
  bus: number;
}

/**
 * Datos completos necesarios para el cierre diario
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
  /** Monto fijo de transferencia diaria a caja chica ($20) */
  transferenciaDiariaCajaChica: number;
}
