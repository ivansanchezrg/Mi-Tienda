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
    referencia_id?: string;    // venta_id para VENTA/ANULACION_VENTA; NULL para ajustes manuales
    presentacion_id?: string;  // UUID de la presentacion usada; NULL = venta directa o ajuste manual
    observaciones?: string;

    // Relacional (JOIN opcional)
    producto?: Producto;
    presentacion?: { nombre: string; factor_conversion: number };
}
