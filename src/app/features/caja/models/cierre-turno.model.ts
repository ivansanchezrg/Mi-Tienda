/**
 * Snapshot reconstruido del cierre de un turno.
 * Reproducido por fn_listar_cierres_turno a partir del ledger inmutable.
 */
export interface CierreTurnoSnapshot {
  turno_id: string;
  numero_turno: number;
  empleado_id: string;
  empleado_nombre: string;
  hora_fecha_apertura: string;
  hora_fecha_cierre: string;
  fondo_apertura: number;
  ventas_pos_efectivo: number;
  egresos: number;
  otros_ingresos: number;
  efectivo_fisico: number;
  /** > 0 sobrante, < 0 faltante, = 0 cuadrado */
  diferencia: number;
  deposito_caja: number;
  transferencia_varios: number;
  saldo_anterior_caja: number;
  saldo_final_caja: number;
  saldo_anterior_varios: number;
  saldo_final_varios: number;
  celular_habilitado: boolean;
  saldo_anterior_celular: number;
  saldo_final_celular: number;
  venta_celular: number;
  saldo_virtual_anterior_celular: number;
  saldo_virtual_final_celular: number;
  bus_habilitado: boolean;
  saldo_anterior_bus: number;
  saldo_final_bus: number;
  venta_bus: number;
  saldo_virtual_anterior_bus: number;
  saldo_virtual_final_bus: number;
  varios_activa: boolean;
  observaciones: string | null;
}
