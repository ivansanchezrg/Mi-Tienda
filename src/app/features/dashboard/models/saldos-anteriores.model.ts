/**
 * Saldos virtuales anteriores para el cierre diario
 */
export interface SaldosAnteriores {
  celular: number;
  bus: number;
}

/**
 * Datos completos necesarios para el cierre diario (v5.0)
 * - saldoCaja y transferenciaDiariaCajaChica eliminados: la función SQL los lee directo de BD.
 * - saldoCajaChica renombrado a saldoCajaChicaDigital: refleja que es el saldo digital del cajón físico.
 */
export interface DatosCierreDiario {
  /** Saldos virtuales de celular y bus */
  saldosVirtuales: SaldosAnteriores;
  /** Saldo digital actual de CAJA_CHICA (cajón físico diario) — mostrar en Paso 2 */
  saldoCajaChicaDigital: number;
  /** Saldo actual de CAJA_CELULAR */
  saldoCajaCelular: number;
  /** Saldo actual de CAJA_BUS */
  saldoCajaBus: number;
  /** Fondo fijo diario (viene de configuración) */
  fondoFijo: number;
  /** Monto fijo de transferencia diaria a VARIOS (viene de configuración) — para preview en Paso 3 */
  transferenciaDiariaVarios: number;
  /** Monto agregado de recargas virtuales celular pendientes de cierre */
  agregadoCelularHoy: number;
  /** Monto agregado de recargas virtuales bus pendientes de cierre */
  agregadoBusHoy: number;
}

/**
 * Parámetros para ejecutar el cierre diario (v5.0)
 * - efectivo_recaudado eliminado → ahora se usa efectivo_fisico (conteo físico del empleado)
 * - saldo_anterior_caja y saldo_anterior_caja_chica eliminados: la función SQL los lee de BD
 */
export interface ParamsCierreDiario {
  turno_id: string; // UUID del turno que se está cerrando
  fecha: string;
  empleado_id: string;
  // Conteo físico del empleado (reemplaza efectivo_recaudado de v4)
  efectivo_fisico: number;
  // Recargas
  saldo_celular_final: number;
  saldo_bus_final: number;
  saldo_anterior_celular: number;
  saldo_anterior_bus: number;
  // Saldos de cajas virtuales (celular y bus — CAJA y CAJA_CHICA los lee el SQL)
  saldo_anterior_caja_celular: number;
  saldo_anterior_caja_bus: number;
  // Opcional
  observaciones?: string;
}
