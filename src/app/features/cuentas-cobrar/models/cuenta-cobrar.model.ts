// ──────────────────────────────────────────────
// Modelo: Cuentas por Cobrar (Fiados)
// ──────────────────────────────────────────────

/** Resumen de deuda por cliente — usado en la lista principal */
export interface CuentaCliente {
    cliente_id: string;
    cliente_nombre: string;
    cliente_identificacion: string | null;
    cliente_telefono: string | null;
    total_deuda: number;
    cantidad_ventas: number;
    ultima_venta_fecha: string;
}

/** Venta fiada individual con saldo pendiente */
export interface VentaFiada {
    id: string;
    numero_comprobante: number | null;
    tipo_comprobante: string;
    fecha: string;
    total: number;
    monto_pagado: number;
    saldo_pendiente: number;
    empleado_nombre: string | null;
    /** Campos IVA — relevantes solo para FACTURA */
    base_iva_0: number;
    base_iva_15: number;
    iva_valor: number;
}

/** Ítem de una venta fiada (producto + cantidad + precio) */
export interface VentaFiadaItem {
    id: string;
    producto_nombre: string;
    cantidad: number;
    precio_unitario: number;
    subtotal: number;
}

/** Pago registrado contra una venta fiada */
export interface PagoFiado {
    id: string;
    venta_id: string;
    monto: number;
    metodo_pago: string;
    fecha: string;
    empleado_nombre: string | null;
    observaciones: string | null;
}

/** Resumen de deudas — footer totalizador */
export interface CuentasCobrarResumen {
    total_clientes: number;
    total_deuda: number;
}
