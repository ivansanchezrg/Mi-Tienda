export type TipoMovimientoEmpleado =
  | 'SUELDO_BASE'
  | 'BONO_COMISION'
  | 'FALTANTE_CAJA'
  | 'ADELANTO_SUELDO'
  | 'PAGO_NOMINA'
  | 'AJUSTE_ABONO'
  | 'AJUSTE_CARGO';

export type EstadoLiquidacion = 'PENDIENTE' | 'LIQUIDADO';

export interface MovimientoEmpleado {
  id: string;
  empleado_id: number;
  fecha: string;
  tipo_movimiento: TipoMovimientoEmpleado;
  monto: number;
  turno_id?: string;
  descripcion?: string;
  estado_liquidacion: EstadoLiquidacion;
  liquidado_en?: string;
  creado_por?: number;
  created_at: string;
}

/** Fila de la vista v_saldos_empleados */
export interface SaldoEmpleado {
  empleado_id: number;
  nombre: string;
  saldo: number; // + negocio le debe, - empleado debe
}

export interface InstruccionFisica {
  caja: string;   // 'Varios' | 'Tienda'
  codigo: string;  // 'VARIOS' | 'CAJA'
  monto: number;
}

export interface ResultadoAdelanto {
  success: boolean;
  error?: string;
  movimiento_id?: string;
  monto?: number;
  beneficiario?: string;
  instrucciones_fisicas?: InstruccionFisica[];
  operaciones_ids?: (string | null)[];
}

export interface ResultadoPagoNomina {
  success: boolean;
  error?: string;
  sueldo_bruto?: number;
  total_descuentos?: number;
  detalle_descuentos?: DetalleDescuento[];
  liquido_pagado?: number;
  beneficiario?: string;
  instrucciones_fisicas?: InstruccionFisica[];
  operaciones_ids?: (string | null)[];
  mensaje?: string;
}

export interface DetalleDescuento {
  tipo: string;
  monto: number;
  fecha: string;
  descripcion: string;
}

/** Preview calculado en TypeScript antes de confirmar pago */
export interface PreviewNomina {
  sueldoBase: number;
  descuentos: DetalleDescuento[];
  totalDescuentos: number;
  liquido: number;
  saldoVarios: number;
  saldoCaja: number;
  montoDeVarios: number;
  montoDeCaja: number;
  fondosSuficientes: boolean;
}

/** Labels y colores por tipo de movimiento */
export const TIPO_MOVIMIENTO_CONFIG: Record<TipoMovimientoEmpleado, {
  label: string;
  icon: string;
  color: string;
  signo: '+' | '-';
}> = {
  SUELDO_BASE:    { label: 'Sueldo',         icon: 'wallet-outline',           color: 'success',  signo: '+' },
  BONO_COMISION:  { label: 'Bono/Comision',   icon: 'star-outline',             color: 'success',  signo: '+' },
  FALTANTE_CAJA:  { label: 'Faltante caja',   icon: 'alert-circle-outline',     color: 'danger',   signo: '-' },
  ADELANTO_SUELDO:{ label: 'Adelanto',        icon: 'cash-outline',             color: 'warning',  signo: '-' },
  PAGO_NOMINA:    { label: 'Pago nomina',     icon: 'checkmark-circle-outline', color: 'primary',  signo: '-' },
  AJUSTE_ABONO:   { label: 'Ajuste abono',    icon: 'create-outline',           color: 'success',  signo: '+' },
  AJUSTE_CARGO:   { label: 'Ajuste cargo',    icon: 'create-outline',           color: 'danger',   signo: '-' },
};
