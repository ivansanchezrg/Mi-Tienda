import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { TurnosCajaService } from '../../caja/services/turnos-caja.service';
import { TurnoLocalService } from '../../../core/services/turno-local.service';
import { OutboxService, OutboxVentaPayload } from '../../../core/services/outbox.service';
import { SyncService } from '../../../core/services/sync.service';
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
    /**
     * Instante REAL de la venta (ISO 8601 UTC, capturado al cobrar). Se propaga hasta
     * fn_registrar_venta_pos como p_fecha para que una venta encolada offline conserve
     * su fecha original al sincronizarse — sin esto, el INSERT caía en DEFAULT NOW() y
     * la venta quedaba con la fecha del momento de sincronización (bug: venta de la
     * noche sincronizada al día siguiente aparecía en el día equivocado).
     */
    fechaVenta: string;
}

@Injectable({
    providedIn: 'root'
})
export class PosService {
    private supabase = inject(SupabaseService);
    private turnosService = inject(TurnosCajaService);
    private turnoLocal = inject(TurnoLocalService);
    private outbox = inject(OutboxService);
    private sync = inject(SyncService);

    // ==========================================
    // OPERACIONES POS
    // ==========================================

    /**
     * Resuelve el turno al que colgar la venta — sin roundtrip al servidor por venta (§4.6).
     * 1) Estado en memoria de TurnosCajaService (lo mantienen la query inicial + Realtime).
     * 2) Snapshot local (turno_activo_local) — cold start sin red.
     * Consultar el servidor aquí era el modo de fallo con señal intermitente: el fetch
     * moría en vuelo y la venta se rechazaba con SIN_TURNO aunque el turno existiera.
     */
    private async resolverTurno(): Promise<{ id: string; empleado_id: string }> {
        const turno = this.turnosService.turnoActivoValue;
        if (turno) return { id: turno.id, empleado_id: turno.empleado_id };

        const snapshot = await this.turnoLocal.obtener();
        if (!snapshot) throw new Error('SIN_TURNO');
        return { id: snapshot.turnoId, empleado_id: snapshot.empleadoId };
    }

    /** Transforma el carrito al formato de items que consume fn_registrar_venta_pos. */
    private mapearItems(carrito: CartItem[]) {
        return carrito.map(item => ({
            producto_id: item.id,
            cantidad: item.cantidad,
            precio_unitario: item.precio_venta,
            subtotal: item.subtotal,
            presentacion_id: item.presentacion_id || null
        }));
    }

    /** Arma el payload crudo y lo mete en el outbox; dispara el sync (no-op sin red). */
    private async encolarVenta(
        turno: { id: string; empleado_id: string },
        carrito: CartItem[],
        payload: VentaPayload
    ): Promise<boolean> {
        const outboxPayload: OutboxVentaPayload = {
            turnoId:         turno.id,
            empleadoId:      turno.empleado_id,
            fechaVenta:      payload.fechaVenta,
            clienteId:       payload.clienteId ?? null,
            tipoComprobante: payload.tipoComprobante,
            total:           payload.total,
            subtotal:        payload.subtotal,
            descuento:       payload.descuento,
            descuentoPct:    payload.descuentoPct,
            baseIva0:        payload.baseIva0,
            baseIva15:       payload.baseIva15,
            ivaValor:        payload.ivaValor,
            metodoPago:      payload.metodoPago,
            items:           this.mapearItems(carrito),
        };

        const encolada = await this.outbox.encolar(payload.idempotencyKey, outboxPayload);
        if (encolada) void this.sync.sincronizar();
        return encolada;
    }

    /**
     * Encola una venta para sincronizar (cobro offline, local-first §4.1).
     * Guarda el payload crudo en el outbox y dispara el sync (no-op si sigue sin red).
     * El turno se resuelve de memoria/snapshot local. Devuelve true si se encoló.
     */
    async encolarVentaOffline(carrito: CartItem[], payload: VentaPayload): Promise<boolean> {
        const turno = await this.resolverTurno();
        return this.encolarVenta(turno, carrito, payload);
    }

    async procesarVenta(carrito: CartItem[], payload: VentaPayload) {
        // 1. Resolver el turno (memoria → snapshot local, sin query al servidor)
        const turno = await this.resolverTurno();

        // 2. Preparar los items del carrito para el JSONB del RPC
        const items = this.mapearItems(carrito);

        // 3. RPC directo (sin supabase.call) — necesitamos el error crudo para distinguir
        //    transporte vs datos. showLoading no va aquí: pos.page.ts ya bloquea la pantalla.
        const { data, error } = await this.supabase.client.rpc('fn_registrar_venta_pos', {
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
            p_idempotency_key:   payload.idempotencyKey,
            p_fecha:             payload.fechaVenta
        });

        if (error) {
            // Error de transporte = la "ventana de la muerte" (§4.1): el request murió en
            // vuelo y no se sabe si el servidor procesó. Encolar con la MISMA idempotency
            // key es siempre seguro — si la venta sí llegó, el sync recibirá `duplicado: true`.
            if (this.supabase.esErrorDeTransporte(error)) {
                const encolada = await this.encolarVenta(turno, carrito, payload);
                if (encolada) {
                    return { success: true, encolada: true, ventaId: null, numeroComprobante: null };
                }
            }
            const rawMsg = error.message || 'Error al registrar la venta';
            const superadminMatch = rawMsg.match(/superadmin_blocked:\s*(.+)/i);
            throw new Error(superadminMatch ? superadminMatch[1].trim() : rawMsg);
        }

        const resultado = data as { success: boolean; venta_id: string; numero_comprobante: number } | null;
        if (!resultado?.success) {
            return { success: false, encolada: false, ventaId: null, numeroComprobante: null };
        }

        return {
            success:           true,
            encolada:          false,
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
