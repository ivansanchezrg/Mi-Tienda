/** Snapshot completo retornado por fn_datos_cierre_diario para el wizard de cierre. */
export interface DatosCierreDiario {
  turnoActivo: {
    id: string;
    numero_turno: number;
    empleado_id: string;
    hora_fecha_apertura: string;
    hora_fecha_cierre: string | null;
    fondo_apertura: number;
    empleado: { id: string; nombre: string } | null;
  } | null;
  saldosVirtuales:      { celular: number; bus: number };
  snapshotVirtuales:    { celular: number; bus: number };
  agregadoVirtualHoy:   { celular: number; bus: number };
  saldosCajas:          { cajaChicaDigital: number; cajaCelular: number; cajaBus: number };
  saldosAntesCierre:    { caja: number; varios: number };
  transferenciaDiariaVarios: number;
  transferenciaYaHecha: boolean;
  resumenTurno:         { ventasPosEfectivo: number; egresos: number };
  configuracion:        { recargasCelularHabilitada: boolean; recargasBusHabilitada: boolean; cajaVariosActiva: boolean };
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
