import { Producto } from '../../inventario/models/producto.model';

export interface CartItem extends Producto {
    cantidad: number;
    subtotal: number;
}
