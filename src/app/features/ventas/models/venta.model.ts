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
    // Presentacion (v8)
    presentacion_id?: string;
    // JOINs
    producto_nombre?: string;
    unidad_medida?: string;
    presentacion_nombre?: string;
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
    total_descuentos: number;
    clientes_unicos: number;
    costo_total: number;
    ganancia_bruta: number;
    margen_pct: number;
    ticket_promedio: number;
    total_monto_anterior: number;
    total_ventas_anterior: number;
    ganancia_anterior: number;
    productos_sin_movimiento: number;
    por_metodo_pago: ReporteMetodoPago[];
    por_tipo_comprobante: ReporteTipoComprobante[];
    top_productos: ProductoMasVendido[];
    top_productos_rentables: ProductoRentable[];
    productos_baja_rotacion: ProductoBajaRotacion[];
    ventas_por_hora: VentaPorHora[];
}

export interface ProductoBajaRotacion {
    producto_id: string;
    nombre: string;
    total_unidades: number;
    total_monto: number;
}

export interface ProductoRentable {
    producto_id: string;
    nombre: string;
    total_unidades: number;
    ganancia: number;
    margen_pct: number;
}

export interface VentaPorHora {
    hora: number;
    cantidad: number;
    monto: number;
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
    empleado_id: string;
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
