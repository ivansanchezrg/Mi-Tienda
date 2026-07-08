import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../../features/auth/services/auth.service';
import { LoggerService } from './logger.service';
import { LocalDbService } from './local-db.service';

/** Estados de una venta en la cola offline. */
export type OutboxEstado = 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR';

/** Payload crudo de la venta — el mismo objeto que va a fn_registrar_venta_pos. */
export interface OutboxVentaPayload {
    turnoId: string;
    empleadoId: string;
    clienteId: string | null;
    tipoComprobante: string;
    total: number;
    subtotal: number;
    descuento: number;
    descuentoPct: number;
    baseIva0: number;
    baseIva15: number;
    ivaValor: number;
    metodoPago: string;
    items: {
        producto_id: string;
        cantidad: number;
        precio_unitario: number;
        subtotal: number;
        presentacion_id: string | null;
    }[];
}

/** Una venta en la cola local (fila de outbox_ventas). */
export interface OutboxVenta {
    idempotencyKey: string;
    negocioId: string;
    turnoId: string;
    payload: OutboxVentaPayload;
    estado: OutboxEstado;
    intentos: number;
    ultimoError: string | null;
    createdAt: number;
}

/**
 * OutboxService — cola durable de ventas pendientes (Local-First, §4.1-4.4 PLAN-OFFLINE-POS).
 *
 * La venta se guarda aquí ANTES de tocar la red (estado PENDING) → existe en disco en
 * milisegundos → el cajero sigue vendiendo sin esperar al servidor. El SyncService la
 * empuja a Supabase cuando hay red; la idempotency_key hace el reenvío 100% seguro.
 *
 * Esta capa NO calcula nada financiero: guarda el payload CRUDO tal cual va al RPC.
 * El servidor sigue siendo la única fuente de verdad (stock, kardex, secuencias, saldos).
 *
 * Multi-tenant: filtra por negocio_id. FIFO por created_at (el trigger de saldo de caja
 * suma cada venta EFECTIVO en orden de inserción — drenar fuera de orden descuadraría).
 */
@Injectable({ providedIn: 'root' })
export class OutboxService {
    private auth    = inject(AuthService);
    private logger  = inject(LoggerService);
    private localDb = inject(LocalDbService);

    // Contador reactivo de pendientes (PENDING + ERROR) — alimenta el badge del banner
    // y la barrera del cierre. Se refresca tras cada mutación de la cola.
    private _pendientes$ = new BehaviorSubject<number>(0);
    readonly pendientes$ = this._pendientes$.asObservable();

    private get negocioId(): string | null {
        return this.auth.usuarioActualValue?.negocio_id ?? null;
    }

    /** Encola una venta nueva en estado PENDING. Devuelve true si se guardó. */
    async encolar(idempotencyKey: string, payload: OutboxVentaPayload): Promise<boolean> {
        const negocioId = this.negocioId;
        if (!negocioId) return false;

        try {
            const db = await this.localDb.getDb(negocioId);
            // Todos los valores como placeholders (?) — el IndexedDbAdapter mapea columna↔param
            // por posición, así que no admite literales intercalados en el VALUES.
            await db.run(
                `INSERT OR REPLACE INTO outbox_ventas
                 (idempotency_key, negocio_id, turno_id, payload_json, estado, intentos, ultimo_error, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [idempotencyKey, negocioId, payload.turnoId, JSON.stringify(payload), 'PENDING', 0, null, Date.now()]
            );
            await this.refrescarContador();
            return true;
        } catch (err) {
            this.logger.error('OutboxService', 'Error al encolar venta', err);
            return false;
        }
    }

    /** Ventas en cola (PENDING o ERROR), en orden FIFO. Las SYNCED no se incluyen. */
    async obtenerPendientes(): Promise<OutboxVenta[]> {
        const negocioId = this.negocioId;
        if (!negocioId) return [];

        try {
            const db  = await this.localDb.getDb(negocioId);
            const res = await db.query(
                `SELECT * FROM outbox_ventas WHERE negocio_id = ?`,
                [negocioId]
            );
            return res
                .map(r => this.mapRow(r))
                .filter(v => v.estado === 'PENDING' || v.estado === 'ERROR')
                .sort((a, b) => a.createdAt - b.createdAt);
        } catch (err) {
            this.logger.error('OutboxService', 'Error al leer la cola', err);
            return [];
        }
    }

    /** Cantidad de ventas sin sincronizar (PENDING + ERROR). Usado por la barrera del cierre. */
    async cantidadPendientes(): Promise<number> {
        return (await this.obtenerPendientes()).length;
    }

    /** Marca una venta con un nuevo estado (y opcionalmente error / incremento de intentos). */
    async marcarEstado(
        idempotencyKey: string,
        estado: OutboxEstado,
        opts: { error?: string | null; incrementarIntento?: boolean } = {}
    ): Promise<void> {
        const negocioId = this.negocioId;
        if (!negocioId) return;

        try {
            const db = await this.localDb.getDb(negocioId);
            if (opts.incrementarIntento) {
                const row = (await db.query(
                    `SELECT intentos FROM outbox_ventas WHERE idempotency_key = ? LIMIT 1`,
                    [idempotencyKey]
                ))[0];
                const intentos = (row?.['intentos'] ?? 0) + 1;
                await db.run(
                    `UPDATE outbox_ventas SET estado = ?, ultimo_error = ?, intentos = ? WHERE idempotency_key = ?`,
                    [estado, opts.error ?? null, intentos, idempotencyKey]
                );
            } else {
                await db.run(
                    `UPDATE outbox_ventas SET estado = ?, ultimo_error = ? WHERE idempotency_key = ?`,
                    [estado, opts.error ?? null, idempotencyKey]
                );
            }
            await this.refrescarContador();
        } catch (err) {
            this.logger.error('OutboxService', 'Error al marcar estado', err);
        }
    }

    /** Elimina una venta de la cola (tras sincronizar con éxito). */
    async eliminar(idempotencyKey: string): Promise<void> {
        const negocioId = this.negocioId;
        if (!negocioId) return;

        try {
            const db = await this.localDb.getDb(negocioId);
            await db.run(`DELETE FROM outbox_ventas WHERE idempotency_key = ?`, [idempotencyKey]);
            await this.refrescarContador();
        } catch (err) {
            this.logger.error('OutboxService', 'Error al eliminar de la cola', err);
        }
    }

    /** Recalcula el contador reactivo de pendientes. */
    async refrescarContador(): Promise<void> {
        this._pendientes$.next(await this.cantidadPendientes());
    }

    /**
     * Reescribe el clienteId de todas las ventas en cola que apuntaban al UUID local
     * de un cliente creado offline, tras el upsert server-side (Fase D — el servidor
     * detectó que la identificación ya existía y reusó su propio id). Sin esto la venta
     * viajaría con un cliente_id que el servidor nunca creó → rechazo por FK.
     */
    async remapearClienteId(idViejo: string, idNuevo: string): Promise<void> {
        const negocioId = this.negocioId;
        if (!negocioId) return;

        try {
            const db  = await this.localDb.getDb(negocioId);
            const res = await db.query(`SELECT * FROM outbox_ventas WHERE negocio_id = ?`, [negocioId]);
            const afectadas = res
                .map(r => this.mapRow(r))
                .filter(v => v.payload.clienteId === idViejo);

            for (const venta of afectadas) {
                const payload = { ...venta.payload, clienteId: idNuevo };
                await db.run(
                    `UPDATE outbox_ventas SET payload_json = ? WHERE idempotency_key = ?`,
                    [JSON.stringify(payload), venta.idempotencyKey]
                );
            }
        } catch (err) {
            this.logger.error('OutboxService', 'Error al remapear clienteId', err);
        }
    }

    private mapRow(r: { [col: string]: any }): OutboxVenta {
        return {
            idempotencyKey: r['idempotency_key'],
            negocioId:      r['negocio_id'],
            turnoId:        r['turno_id'],
            payload:        JSON.parse(r['payload_json']),
            estado:         r['estado'],
            intentos:       r['intentos'] ?? 0,
            ultimoError:    r['ultimo_error'] ?? null,
            createdAt:      r['created_at'],
        };
    }
}
