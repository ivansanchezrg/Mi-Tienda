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
  caja_id: string;
  empleado_id: string | null;
  tipo_operacion: TipoOperacionCaja;
  monto: number;
  saldo_anterior: number | null;
  saldo_actual: number | null;
  categoria_id: string | null;
  tipo_referencia_id: string | null;
  referencia_id: string | null;
  descripcion: string | null;
  comprobante_url: string | null;

  // Relations (joins)
  caja?: {
    id: string;
    nombre: string;
    codigo: string;
  };
  empleado?: {
    id: string;
    nombre: string;
  } | null;
  categoria?: {
    id: string;
    nombre: string;
    codigo: string;
    tipo: 'INGRESO' | 'EGRESO';
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
