import { ProductoPOS } from '../../inventario/models/producto.model';

export interface CartItem extends ProductoPOS {
    cantidad: number;
    subtotal: number;
    // Padre-hijo: stock real y destino de descuento
    producto_stock_id?: string;   // UUID del hijo al que se descuenta stock (solo padres)
    cantidad_stock?: number;      // cantidad * factor_conversion (solo padres)
    stock_disponible: number;     // Stock real: del hijo si es padre, propio si no
}
