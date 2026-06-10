import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { NetworkService } from './network.service';
import { LoggerService } from './logger.service';
import { OutboxService, OutboxVenta } from './outbox.service';

/**
 * SyncService — drena la cola del OutboxService contra Supabase (§4.4 PLAN-OFFLINE-POS).
 *
 * Local-First: las ventas ya están en disco (OutboxService). Este servicio las empuja
 * al servidor cuando hay red, en orden FIFO estricto (el trigger de saldo de caja suma
 * cada venta EFECTIVO en orden de inserción — drenar fuera de orden descuadra el ledger).
 *
 * Disparo automático: al volver la red (NetworkService) y tras encolar. Manual: botón
 * "Sincronizar ahora". La idempotency_key hace el reenvío 100% seguro (un duplicado en el
 * servidor responde success).
 *
 * Clasificación de fallos:
 *   • Error de RED      → la venta queda PENDING, se reintenta luego (no se quema un intento real).
 *   • Error de DATOS    → ERROR (dead-letter): no se reintenta en loop, visible en tab Pendientes.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
    private supabase = inject(SupabaseService);
    private network  = inject(NetworkService);
    private logger   = inject(LoggerService);
    private outbox   = inject(OutboxService);

    private sincronizando = false;

    constructor() {
        // Disparo automático al volver la red. El primer valor del BehaviorSubject puede
        // ser true (online), pero sincronizar() es no-op si la cola está vacía.
        this.network.getNetworkStatus().subscribe(online => {
            if (online) void this.sincronizar();
        });
    }

    /**
     * Drena la cola en orden FIFO. Reentrante-seguro: si ya hay un drenado en curso,
     * retorna sin duplicar. Se detiene al primer error de red (no tiene sentido seguir
     * intentando sin conexión) o al primer error de datos (preserva el orden FIFO).
     */
    async sincronizar(): Promise<void> {
        if (this.sincronizando) return;
        if (!this.network.isConnected()) return;

        this.sincronizando = true;
        try {
            const pendientes = await this.outbox.obtenerPendientes(); // ya viene FIFO
            for (const venta of pendientes) {
                if (!this.network.isConnected()) break; // se cayó la red a mitad de drenado

                const resultado = await this.empujarVenta(venta);
                if (resultado === 'red') break;   // cortar — el listener reintentará al volver la red
                if (resultado === 'datos') break; // cortar — mantener FIFO; la cola queda bloqueada en esta venta
                // 'ok' → continúa con la siguiente
            }
        } finally {
            this.sincronizando = false;
        }
    }

    /**
     * Empuja una venta al servidor. Marca SYNCING → al RPC → SYNCED+eliminar | PENDING | ERROR.
     * Retorna 'ok' | 'red' | 'datos' para que el bucle decida si continuar.
     */
    private async empujarVenta(venta: OutboxVenta): Promise<'ok' | 'red' | 'datos'> {
        await this.outbox.marcarEstado(venta.idempotencyKey, 'SYNCING');
        const p = venta.payload;

        try {
            const { error } = await this.supabase.client.rpc('fn_registrar_venta_pos', {
                p_turno_id:                p.turnoId,
                p_empleado_id:             p.empleadoId,
                p_cliente_id:              p.clienteId,
                p_tipo_comprobante:        p.tipoComprobante,
                p_total:                   p.total,
                p_subtotal:                p.subtotal,
                p_descuento:               p.descuento,
                p_descuento_pct:           p.descuentoPct,
                p_base_iva_0:              p.baseIva0,
                p_base_iva_15:             p.baseIva15,
                p_iva_valor:               p.ivaValor,
                p_metodo_pago:             p.metodoPago,
                p_items:                   p.items,
                p_idempotency_key:         venta.idempotencyKey,
                p_permitir_stock_negativo: true, // stock offline optimista (§5)
            });

            if (!error) {
                // success o duplicado (idempotencia) → ambos son éxito
                await this.outbox.eliminar(venta.idempotencyKey);
                return 'ok';
            }

            if (this.esErrorDeRed(error)) {
                await this.outbox.marcarEstado(venta.idempotencyKey, 'PENDING', { error: error.message });
                return 'red';
            }

            // Error de datos (validación del servidor) → dead-letter
            await this.outbox.marcarEstado(venta.idempotencyKey, 'ERROR', {
                error: error.message, incrementarIntento: true,
            });
            this.logger.error('SyncService', `Venta ${venta.idempotencyKey} rechazada por el servidor`, error);
            return 'datos';

        } catch (err: any) {
            // Excepción de transporte (sin conexión, timeout) → tratar como red
            await this.outbox.marcarEstado(venta.idempotencyKey, 'PENDING', { error: err?.message ?? 'error de red' });
            return 'red';
        }
    }

    /** Heurística: errores de transporte/conexión vs errores SQL del servidor. */
    private esErrorDeRed(error: { message?: string; code?: string }): boolean {
        const msg = (error.message ?? '').toLowerCase();
        return msg.includes('failed to fetch')
            || msg.includes('network')
            || msg.includes('fetch')
            || msg.includes('timeout')
            || error.code === undefined && msg === ''; // sin code ni mensaje → no llegó al servidor
    }
}
