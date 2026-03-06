import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { TurnosCajaService } from '../../dashboard/services/turnos-caja.service';
import { CartItem } from '../models/cart-item.model';

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
     *   1. INSERT en `ventas`
     *   2. INSERT en `ventas_detalles` (por cada ítem)
     *   3. Trigger `trg_descontar_stock_venta` → descuenta stock + graba kardex
     *   4. Trigger `trg_actualizar_caja_por_venta` → sube saldo CAJA si es EFECTIVO
     */
    async procesarVenta(carrito: CartItem[], totalPagar: number, metodoPago: string = 'EFECTIVO') {
        // 1. Obtener el turno activo (requerido por la BD)
        const turno = await this.turnosService.obtenerTurnoActivo();
        if (!turno) {
            throw new Error('No hay un turno de caja abierto. Abre la caja antes de cobrar.');
        }

        // 2. Preparar los ítems del carrito para el JSONB del RPC
        const items = carrito.map(item => ({
            producto_id: item.id,
            cantidad: item.cantidad,
            precio_unitario: item.precio_venta,
            subtotal: item.subtotal
        }));

        // 3. Llamar a la función PostgreSQL (1 sola llamada — transacción atómica)
        const resultado = await this.supabase.call<{ success: boolean; venta_id: string }>(
            this.supabase.client.rpc('registrar_venta_pos', {
                p_turno_id: turno.id,
                p_empleado_id: turno.empleado_id,
                p_total: totalPagar,
                p_subtotal: totalPagar,   // MVP: sin IVA → subtotal = total
                p_metodo_pago: metodoPago,
                p_items: items
            })
            // Quitamos el showLoading: true aquí porque pos.page.ts 
            // ya lo está bloqueando manualmente de forma proactiva
        );

        if (!resultado || !resultado.success) {
            // No hacemos throw new Error aquí. 
            // SupabaseService.call YA se encargó de atrapar el error real de PG 
            // y mostarlo en un popup/toast limpio en pantalla.
            return { success: false, ventaId: null };
        }

        return { success: true, ventaId: resultado.venta_id };
    }
}
