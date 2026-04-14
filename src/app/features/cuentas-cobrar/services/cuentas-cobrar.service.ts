import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { PAGINATION_CONFIG } from '../../../core/config/pagination.config';
import {
    CuentaCliente,
    VentaFiada,
    VentaFiadaItem,
    PagoFiado,
    CuentasCobrarResumen
} from '../models/cuenta-cobrar.model';

@Injectable({
    providedIn: 'root'
})
export class CuentasCobrarService {
    private supabase = inject(SupabaseService);

    // ──────────────────────────────────────────────
    // LISTA DE CLIENTES CON DEUDA
    // ──────────────────────────────────────────────

    /**
     * Clientes con ventas fiadas pendientes, agrupados con total de deuda.
     * Ordenados por mayor deuda primero.
     */
    async listarClientesConDeuda(page: number, busqueda?: string): Promise<CuentaCliente[]> {
        return await this.supabase.call<CuentaCliente[]>(
            this.supabase.client.rpc('fn_listar_cuentas_cobrar', {
                p_busqueda: busqueda ?? null,
                p_page: page,
                p_page_size: PAGINATION_CONFIG.cuentasCobrar.pageSize,
            })
        ) ?? [];
    }

    /** Resumen global: total clientes con deuda + total $ adeudado */
    async obtenerResumen(busqueda?: string): Promise<CuentasCobrarResumen> {
        const raw = await this.supabase.call<CuentasCobrarResumen[]>(
            this.supabase.client.rpc('fn_resumir_cuentas_cobrar', {
                p_busqueda: busqueda ?? null,
            })
        ) ?? [];
        return raw[0] ?? { total_clientes: 0, total_deuda: 0 };
    }

    // ──────────────────────────────────────────────
    // DETALLE: VENTAS FIADAS DE UN CLIENTE
    // ──────────────────────────────────────────────

    /** Ventas fiadas pendientes (total o parcialmente) de un cliente */
    async obtenerVentasFiadas(clienteId: string): Promise<VentaFiada[]> {
        const query = this.supabase.client
            .from('ventas')
            .select('id, numero_comprobante, tipo_comprobante, fecha, subtotal, descuento, descuento_pct, total, base_iva_0, base_iva_15, iva_valor, empleado:empleado_id(nombre), cuentas_cobrar(monto)')
            .eq('cliente_id', clienteId)
            .eq('metodo_pago', 'FIADO')
            .eq('estado', 'COMPLETADA')
            .in('estado_pago', ['PENDIENTE', 'PAGADO_PARCIAL'])
            .order('fecha', { ascending: true });

        const { data, error } = await query;
        if (error) return [];

        return (data ?? []).map((v: any) => {
            const montoPagado = (v.cuentas_cobrar as { monto: number }[] ?? [])
                .reduce((sum, p) => sum + p.monto, 0);
            return {
                id: v.id,
                numero_comprobante: v.numero_comprobante,
                tipo_comprobante: v.tipo_comprobante,
                fecha: v.fecha,
                subtotal: v.subtotal ?? v.total,
                descuento: v.descuento ?? 0,
                descuento_pct: v.descuento_pct ?? 0,
                total: v.total,
                monto_pagado: montoPagado,
                saldo_pendiente: v.total - montoPagado,
                empleado_nombre: v.empleado?.nombre ?? null,
                base_iva_0: v.base_iva_0 ?? 0,
                base_iva_15: v.base_iva_15 ?? 0,
                iva_valor: v.iva_valor ?? 0,
            };
        });
    }

    /** Ítems (productos) de una venta fiada — para el estado de cuenta compartible */
    async obtenerItemsVenta(ventaId: string): Promise<VentaFiadaItem[]> {
        const data = await this.supabase.call<any[]>(
            this.supabase.client
                .from('ventas_detalles')
                .select('id, cantidad, precio_unitario, subtotal, producto:producto_id(nombre)')
                .eq('venta_id', ventaId)
        ) ?? [];

        return data.map(d => ({
            id: d.id,
            producto_nombre: d.producto?.nombre ?? 'Producto',
            cantidad: d.cantidad,
            precio_unitario: d.precio_unitario,
            subtotal: d.subtotal,
        }));
    }

    /** Historial de pagos de una venta fiada específica */
    async obtenerPagosVenta(ventaId: string): Promise<PagoFiado[]> {
        const data = await this.supabase.call<any[]>(
            this.supabase.client
                .from('cuentas_cobrar')
                .select('id, venta_id, monto, metodo_pago, fecha, observaciones, empleado:empleado_id(nombre)')
                .eq('venta_id', ventaId)
                .order('fecha', { ascending: false })
        ) ?? [];

        return data.map(p => ({
            ...p,
            empleado_nombre: p.empleado?.nombre ?? null,
        }));
    }

    // ──────────────────────────────────────────────
    // REGISTRAR PAGO
    // ──────────────────────────────────────────────

    /**
     * Registra un pago (total o parcial) contra una venta fiada.
     * La función SQL:
     *   1. Inserta en cuentas_cobrar
     *   2. Actualiza estado_pago de la venta
     *   3. Si es EFECTIVO → ingresa a CAJA_CHICA
     */
    async registrarPago(ventaId: string, monto: number, metodoPago: string, observaciones?: string, silencioso = false): Promise<{ success: boolean }> {
        const resultado = await this.supabase.call<{ success: boolean }>(
            this.supabase.client.rpc('fn_registrar_pago_fiado', {
                p_venta_id: ventaId,
                p_monto: monto,
                p_metodo_pago: metodoPago,
                p_observaciones: observaciones ?? null,
            }),
            silencioso ? undefined : 'Pago registrado correctamente'
        );
        return resultado ?? { success: false };
    }
}
