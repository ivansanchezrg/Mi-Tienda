import { CategoriaProducto } from './categoria-producto.model';

export type TipoVenta = 'UNIDAD' | 'PESO';

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

    // Granel + padre-hijo
    tipo_venta: TipoVenta;
    unidad_medida: string;          // 'und', 'kg', 'lb', 'g', 'ml', 'L'
    producto_hijo_id?: string;      // UUID del hijo (solo padres: cajetilla→cigarro)
    factor_conversion: number;      // Unidades del hijo por 1 padre (default 1)

    // Relacional (Opcional si hacemos el Join con Supabase)
    categoria?: CategoriaProducto;
    producto_hijo?: { nombre: string; stock_actual: number; precio_costo: number };
    producto_padre?: { id: string; nombre: string; precio_venta: number; factor_conversion: number }; // Inversa: empaque que contiene esta unidad
}

/** Proyección liviana para búsqueda POS — campos necesarios para mostrar resultados y calcular totales/IVA. */
export type ProductoPOS = Pick<Producto,
    'id' | 'nombre' | 'codigo_barras' | 'precio_venta' |
    'stock_actual' | 'stock_minimo' | 'imagen_url' | 'tiene_iva' |
    'tipo_venta' | 'unidad_medida' | 'producto_hijo_id' | 'factor_conversion'
>;
