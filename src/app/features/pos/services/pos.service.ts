import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { TurnosCajaService } from '../../caja/services/turnos-caja.service';
import { CartItem } from '../models/cart-item.model';

export interface VentaPayload {
    total: number;
    subtotal: number;        // base neta sin IVA (= total en TICKET/NOTA_VENTA, = base0+base15 en FACTURA)
    descuento: number;       // descuento automático aplicado (0 si no aplica o si es FIADO)
    descuentoPct: number;    // porcentaje aplicado (0 si no aplica o si es FIADO)
    metodoPago: string;
    tipoComprobante: string;
    clienteId?: string;
    baseIva0: number;
    baseIva15: number;
    ivaValor: number;
    idempotencyKey: string;  // UUID generado antes del RPC — protección contra duplicados
}

@Injectable({
    providedIn: 'root'
})
export class PosService {
    private supabase = inject(SupabaseService);
    private turnosService = inject(TurnosCajaService);

    // ==========================================
    // OPERACIONES POS
    // ==========================================

    /**
     * Registra una venta completa en una transacción atómica via RPC PostgreSQL.
     * Si cualquier paso falla, la BD hace rollback automático.
     *
     * El flujo dentro de la función SQL:
     *   1. INSERT en `ventas` (con tipo_comprobante, IVA, cliente_id)
     *   2. INSERT en `ventas_detalles` (por cada ítem)
     *   3. Trigger `trg_descontar_stock_venta` → descuenta stock + graba kardex
     *   4. Trigger `trg_actualizar_caja_por_venta` → sube saldo CAJA_CHICA si es EFECTIVO (v5)
     */
    async hayTurnoActivo(): Promise<boolean> {
        const turno = await this.turnosService.obtenerTurnoActivo();
        return !!turno;
    }

    async procesarVenta(carrito: CartItem[], payload: VentaPayload) {
        // 1. Obtener el turno activo (requerido por la BD)
        const turno = await this.turnosService.obtenerTurnoActivo();
        if (!turno) {
            throw new Error('SIN_TURNO');
        }

        // 2. Preparar los items del carrito para el JSONB del RPC
        const items = carrito.map(item => ({
            producto_id: item.id,
            cantidad: item.cantidad,
            precio_unitario: item.precio_venta,
            subtotal: item.subtotal,
            presentacion_id: item.presentacion_id || null
        }));

        // 3. Llamar a la función PostgreSQL (1 sola llamada — transacción atómica)
        const resultado = await this.supabase.call<{ success: boolean; venta_id: string; numero_comprobante: number }>(
            this.supabase.client.rpc('fn_registrar_venta_pos', {
                p_turno_id:          turno.id,
                p_empleado_id:       turno.empleado_id,
                p_cliente_id:        payload.clienteId ?? null,
                p_tipo_comprobante:  payload.tipoComprobante,
                p_total:             payload.total,
                p_subtotal:          payload.subtotal,
                p_descuento:         payload.descuento,
                p_descuento_pct:     payload.descuentoPct,
                p_base_iva_0:        payload.baseIva0,
                p_base_iva_15:       payload.baseIva15,
                p_iva_valor:         payload.ivaValor,
                p_metodo_pago:       payload.metodoPago,
                p_items:             items,
                p_idempotency_key:   payload.idempotencyKey
            })
            // showLoading no va aquí — pos.page.ts ya bloquea la pantalla proactivamente
        );

        if (!resultado || !resultado.success) {
            return { success: false, ventaId: null, numeroComprobante: null };
        }

        return {
            success:           true,
            ventaId:           resultado.venta_id,
            numeroComprobante: resultado.numero_comprobante,
        };
    }

    /**
     * Verifica si una venta con la idempotency_key dada ya existe en BD.
     * Usado para recuperar ventas pendientes tras crash/cierre de app.
     */
    async verificarVentaPorIdempotencyKey(key: string) {
        return this.supabase.client
            .from('ventas')
            .select('id')
            .eq('idempotency_key', key)
            .maybeSingle();
    }
}
