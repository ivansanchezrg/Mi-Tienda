import { CategoriaProducto } from './categoria-producto.model';

export type TipoVenta = 'UNIDAD' | 'PESO';

export interface ProductoPresentacion {
    id: string;
    producto_id: string;
    nombre: string;              // "Cajetilla x10", "Cubeta x30"
    factor_conversion: number;   // unidades base por presentacion
    precio_venta: number;        // precio de venta de esta presentacion
    codigo_barras?: string;
    es_principal: boolean;
    activo: boolean;
}

export interface Producto {
    id: string; // UUID
    categoria_id?: number;
    codigo_barras?: string;
    nombre: string;
    precio_costo: number;
    precio_venta: number;
    stock_actual: number;
    stock_minimo: number;
    tiene_iva: boolean;
    activo: boolean;
    imagen_url?: string;
    created_at?: string;

    // Granel
    tipo_venta: TipoVenta;
    unidad_medida: string;          // 'und', 'kg', 'lb', 'g', 'ml', 'L'

    // Relacional (Opcional si hacemos el Join con Supabase)
    categoria?: CategoriaProducto;
    presentaciones?: ProductoPresentacion[];  // cargadas on-demand
}

/** Proyeccion liviana para busqueda POS — campos necesarios para mostrar resultados y calcular totales/IVA. */
export type ProductoPOS = Pick<Producto,
    'id' | 'nombre' | 'codigo_barras' | 'precio_venta' |
    'stock_actual' | 'stock_minimo' | 'imagen_url' | 'tiene_iva' |
    'tipo_venta' | 'unidad_medida'
> & {
    presentaciones?: ProductoPresentacion[];   // cargadas en la busqueda POS (JOIN)
};
