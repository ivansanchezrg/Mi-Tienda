// ──────────────────────────────────────────────
// Modelo: Cuentas por Cobrar (Fiados)
// ──────────────────────────────────────────────

/**
 * Cliente con saldo pendiente — listado unificado.
 * total_deuda: null significa "requiere conexión" (offline, §4.3 PLAN-OFFLINE-CALLE) —
 * distinto de 0 (sin deuda), que sí es un valor real calculado por el servidor.
 */
export interface ClienteConSaldo {
    cliente_id: string;
    cliente_nombre: string;
    cliente_identificacion: string | null;
    cliente_telefono: string | null;
    total_deuda: number | null;
    cantidad_ventas_fiadas: number;
    ultima_venta_fecha: string | null;
}

/** Venta fiada individual con saldo pendiente */
export interface VentaFiada {
    id: string;
    numero_comprobante: number | null;
    tipo_comprobante: string;
    fecha: string;
    subtotal: number;
    descuento: number;
    descuento_pct: number;
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
