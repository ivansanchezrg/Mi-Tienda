import { CategoriaProducto } from './categoria-producto.model';

export type TipoVenta = 'UNIDAD' | 'PESO';

// ── Atributos dinamicos (v10) ──

export interface Atributo {
    id: string;
    nombre: string;              // "SABOR", "COLOR", "TAMAÑO"
    created_at?: string;
}

export interface AtributoOpcion {
    id: string;
    atributo_id: string;
    valor: string;               // "FRESA", "ROJO", "XL"
    atributo?: Atributo;         // JOIN opcional
    created_at?: string;
}

export interface ProductoAtributo {
    producto_id: string;
    atributo_opcion_id: string;
    atributo_opcion?: AtributoOpcion;  // JOIN con atributo anidado
}

// ── Template de producto (v10.1) ──

export interface TemplateAtributo {
    id: string;
    template_id: string;
    atributo_id: string;
    // JOINs opcionales
    atributo?: Atributo;
    opciones?: AtributoOpcion[];   // opciones seleccionadas para este tipo en el template
}

export interface ProductoTemplate {
    id: string;
    nombre: string;
    categoria_id?: string;
    tipo_venta: TipoVenta;
    unidad_medida: string;
    imagen_url?: string | null;
    activo: boolean;
    created_at?: string;

    // Relacional (JOIN opcional)
    categoria?: CategoriaProducto;
    template_atributos?: TemplateAtributo[];  // tipos + opciones del template
}

// ── Presentaciones ──

export interface ProductoPresentacion {
    id: string;
    producto_id: string;
    nombre: string;              // "Cajetilla x10", "Cubeta x30"
    factor_conversion: number;   // unidades base por presentacion
    precio_venta: number;        // precio de venta de esta presentacion
    precio_costo: number;        // costo real del paquete (obligatorio)
    codigo_barras?: string;
    imagen_url?: string | null;
    es_principal: boolean;
    activo: boolean;
}

// ── Producto / SKU ──

export interface Producto {
    id: string; // UUID
    producto_template_id?: string;
    categoria_id?: string;
    codigo_barras?: string;
    nombre: string;
    precio_costo: number;
    precio_venta: number;
    stock_actual: number;
    stock_minimo: number;
    tiene_iva: boolean;
    activo: boolean;
    imagen_url?: string | null;
    created_at?: string;

    // Granel
    tipo_venta: TipoVenta;
    unidad_medida: string;          // 'und', 'kg', 'lb', 'g', 'ml', 'L'

    // Relacional (JOIN opcional)
    categoria?: CategoriaProducto;
    producto_template?: ProductoTemplate;
    presentaciones?: ProductoPresentacion[];  // cargadas on-demand
    atributos?: ProductoAtributo[];           // cargados on-demand
}

/** Proyeccion liviana para busqueda POS — campos necesarios para mostrar resultados y calcular totales/IVA. */
export type ProductoPOS = Pick<Producto,
    'id' | 'nombre' | 'codigo_barras' | 'precio_venta' |
    'stock_actual' | 'stock_minimo' | 'imagen_url' | 'tiene_iva' |
    'tipo_venta' | 'unidad_medida' | 'producto_template_id'
> & {
    producto_template?: (Pick<ProductoTemplate, 'id' | 'nombre' | 'imagen_url'> & {
        template_atributos?: { atributo?: Pick<Atributo, 'nombre'> }[];
    }) | null;
    presentaciones?: ProductoPresentacion[];   // cargadas en la busqueda POS (JOIN)
};
