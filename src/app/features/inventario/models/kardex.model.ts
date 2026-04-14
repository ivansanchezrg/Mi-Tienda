import { Producto } from './producto.model';

export type TipoMovimientoKardex = 'VENTA' | 'COMPRA' | 'AJUSTE_POSITIVO' | 'AJUSTE_NEGATIVO' | 'ANULACION_VENTA';

export interface KardexInventario {
    id: string; // UUID
    producto_id: string; // UUID
    fecha: string; // TIMESTAMPTZ
    tipo_movimiento: TipoMovimientoKardex;
    cantidad: number;
    stock_anterior: number;
    stock_nuevo: number;
    referencia_id?: string; // UUID
    observaciones?: string;

    // Relacional
    producto?: Producto;
}
