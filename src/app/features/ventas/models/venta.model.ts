// ──────────────────────────────────────────────
// Modelo: Venta + VentaDetalle
// ──────────────────────────────────────────────

export type MetodoPagoType = 'EFECTIVO' | 'DEUNA' | 'TRANSFERENCIA' | 'FIADO';
export type TipoComprobanteType = 'TICKET' | 'NOTA_VENTA' | 'FACTURA';
export type EstadoVentaType = 'COMPLETADA' | 'ANULADA' | 'PENDIENTE';
export type EstadoPagoType = 'NO_APLICA' | 'PENDIENTE' | 'PAGADO_PARCIAL' | 'PAGADO';

export interface VentaDetalle {
    id: string;
    venta_id: string;
    producto_id: string;
    cantidad: number;
    precio_unitario: number;
    subtotal: number;
    // JOIN productos
    producto_nombre?: string;
}

export interface VentasResumen {
    total_registros: number;
    total_monto: number;
}

// ──────────────────────────────────────────────
// Modelo: Reporte resumen diario
// ──────────────────────────────────────────────

export interface ReporteVentasDia {
    fecha_inicio: string;
    fecha_fin: string;
    total_ventas: number;
    total_monto: number;
    total_anuladas: number;
    monto_anulado: number;
    costo_total: number;
    ganancia_bruta: number;
    margen_pct: number;
    por_metodo_pago: ReporteMetodoPago[];
    por_tipo_comprobante: ReporteTipoComprobante[];
    top_productos: ProductoMasVendido[];
}

export interface ReporteMetodoPago {
    metodo: string;
    cantidad: number;
    monto: number;
}

export interface ReporteTipoComprobante {
    tipo: string;
    cantidad: number;
    monto: number;
}

export interface ProductoMasVendido {
    producto_id: string;
    nombre: string;
    total_unidades: number;
    total_monto: number;
    total_ventas: number;
}

// ──────────────────────────────────────────────
// Modelo: Venta individual
// ──────────────────────────────────────────────

export interface Venta {
    id: string;
    turno_id: string;
    empleado_id: number;
    cliente_id: string | null;
    tipo_comprobante: TipoComprobanteType;
    numero_comprobante: number | null;  // Correlativo interno (ej: 42 → "#42")
    subtotal: number;
    descuento: number;
    descuento_pct: number;
    total: number;
    base_iva_0: number;
    base_iva_15: number;
    iva_valor: number;
    metodo_pago: MetodoPagoType;
    estado: EstadoVentaType;
    estado_pago: EstadoPagoType;
    observaciones?: string | null;
    fecha: string;
    // JOINs opcionales (cuando se carga el detalle completo)
    cliente_nombre?: string | null;
    cliente_identificacion?: string | null;
    empleado_nombre?: string | null;
    ventas_detalles?: VentaDetalle[];
    // Calculado desde cuentas_cobrar (solo en detalle)
    total_abonado?: number;
}
