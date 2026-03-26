export interface ReporteVentasDia {
    fecha: string;
    total_ventas: number;
    total_monto: number;
    total_anuladas: number;
    monto_anulado: number;
    por_metodo_pago: ReporteMetodoPago[];
    por_tipo_comprobante: ReporteTipoComprobante[];
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
