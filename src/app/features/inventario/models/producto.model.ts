import { CategoriaProducto } from './categoria-producto.model';

export interface Producto {
    id: string; // UUID
    categoria_id?: number;
    codigo_barras?: string;
    nombre: string;
    descripcion?: string;
    precio_costo: number;
    precio_venta: number;
    stock_actual: number;
    stock_minimo: number;
    tiene_iva: boolean;
    activo: boolean;
    imagen_url?: string;
    created_at?: string;

    // Relacional (Opcional si hacemos el Join con Supabase)
    categoria?: CategoriaProducto;
}
