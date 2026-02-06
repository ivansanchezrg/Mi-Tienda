/**
 * Tipos de operación en cajas
 */
export enum TipoOperacionCaja {
  APERTURA = 'APERTURA',
  CIERRE = 'CIERRE',
  INGRESO = 'INGRESO',
  EGRESO = 'EGRESO',
  AJUSTE = 'AJUSTE',
  TRANSFERENCIA_ENTRANTE = 'TRANSFERENCIA_ENTRANTE',
  TRANSFERENCIA_SALIENTE = 'TRANSFERENCIA_SALIENTE'
}

/**
 * Operación de caja (refleja tabla operaciones_cajas)
 */
export interface OperacionCaja {
  id: string;
  fecha: string;
  caja_id: number;
  empleado_id: number | null;
  tipo_operacion: TipoOperacionCaja;
  monto: number;
  saldo_anterior: number | null;
  saldo_actual: number | null;
  tipo_referencia_id: number | null;
  referencia_id: string | null;
  descripcion: string | null;
  comprobante_url: string | null;
  created_at: string;

  // Relations (joins)
  caja?: {
    id: number;
    nombre: string;
    codigo: string;
  };
  empleado?: {
    id: number;
    nombre: string;
  } | null;
}

/**
 * Resultado paginado de operaciones
 */
export interface OperacionesPaginadas {
  operaciones: OperacionCaja[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Filtros para consultar operaciones
 */
export type FiltroFecha = 'hoy' | 'semana' | 'mes' | 'todas';
