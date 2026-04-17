import { ProductoPOS } from '../../inventario/models/producto.model';

export interface CartItem extends ProductoPOS {
    cantidad: number;
    subtotal: number;
    stock_disponible: number;
    // Presentacion (null/undefined si venta directa del producto)
    presentacion_id?: string;
    presentacion_nombre?: string;    // Para mostrar en UI: "Cajetilla x10"
    factor_conversion?: number;      // Para calcular stock: cantidad * factor
}
