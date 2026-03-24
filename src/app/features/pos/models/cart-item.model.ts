import { ProductoPOS } from '../../inventario/models/producto.model';

export interface CartItem extends ProductoPOS {
    cantidad: number;
    subtotal: number;
}
