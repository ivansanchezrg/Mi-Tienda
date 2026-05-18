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

/**
 * Resultado agrupado para la lista de búsqueda del POS.
 * - tipo 'simple': producto sin variantes → se agrega directo (o muestra selector de presentaciones)
 * - tipo 'template': grupo de variantes → abre sheet para elegir el SKU
 */
export type ResultadoBusquedaPOS =
    | { tipo: 'simple';   producto: ProductoPOS }
    | { tipo: 'template'; templateNombre: string; templateId: string; variantes: ProductoPOS[] };

/**
 * Item del grid del catálogo POS.
 * - tipo 'simple': producto individual (sin variantes)
 * - tipo 'template': card agrupado que representa todas las variantes de un template
 */
export type CatalogoItem =
    | { tipo: 'simple';   producto: ProductoPOS }
    | { tipo: 'template'; templateId: string; templateNombre: string; templateImagenUrl?: string | null; templateAtributos: string[]; variantes: ProductoPOS[] };
