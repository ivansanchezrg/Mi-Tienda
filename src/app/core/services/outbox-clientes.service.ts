import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../features/auth/services/auth.service';
import { LoggerService } from './logger.service';
import { LocalDbService } from './local-db.service';

/** Estados de un cliente en la cola offline (mismo contrato que OutboxEstado). */
export type OutboxClienteEstado = 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR';

/** Payload crudo del cliente — el mismo objeto que va a fn_upsert_cliente. */
export interface OutboxClientePayload {
    nombre: string;
    identificacion: string | null;
    telefono: string | null;
    email: string | null;
}

/** Un cliente en la cola local (fila de outbox_clientes). */
export interface OutboxCliente {
    id: string; // UUID generado en el cliente — mismo id que el registro en cache_clientes
    negocioId: string;
    payload: OutboxClientePayload;
    estado: OutboxClienteEstado;
    intentos: number;
    ultimoError: string | null;
    createdAt: number;
}

/**
 * OutboxClientesService — cola durable de clientes creados offline (Fase D,
 * PLAN-OFFLINE-CALLE §6.5). Espejo de OutboxService.
 *
 * El vendedor de calle capta un cliente nuevo sin red y quiere el ticket/nota a su
 * nombre. El cliente recibe un UUID generado en el dispositivo (válido como PK real —
 * el schema usa uuid_generate_v4() en `clientes.id`) y se drena ANTES que las ventas
 * que lo referencian (el SyncService garantiza este orden).
 *
 * Multi-tenant: filtra por negocio_id. FIFO por created_at, igual que outbox_ventas.
 */
@Injectable({ providedIn: 'root' })
export class OutboxClientesService {
    private auth    = inject(AuthService);
    private logger  = inject(LoggerService);
    private localDb = inject(LocalDbService);

    private get negocioId(): string | null {
        return this.auth.usuarioActualValue?.negocio_id ?? null;
    }

    /** Encola un cliente nuevo en estado PENDING. Devuelve true si se guardó. */
    async encolar(id: string, payload: OutboxClientePayload): Promise<boolean> {
        const negocioId = this.negocioId;
        if (!negocioId) return false;

        try {
            const db = await this.localDb.getDb(negocioId);
            await db.run(
                `INSERT OR REPLACE INTO outbox_clientes
                 (id, negocio_id, payload_json, estado, intentos, ultimo_error, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, negocioId, JSON.stringify(payload), 'PENDING', 0, null, Date.now()]
            );
            return true;
        } catch (err) {
            this.logger.error('OutboxClientesService', 'Error al encolar cliente', err);
            return false;
        }
    }

    /** Clientes en cola (PENDING o ERROR), en orden FIFO. */
    async obtenerPendientes(): Promise<OutboxCliente[]> {
        const negocioId = this.negocioId;
        if (!negocioId) return [];

        try {
            const db  = await this.localDb.getDb(negocioId);
            const res = await db.query(
                `SELECT * FROM outbox_clientes WHERE negocio_id = ?`,
                [negocioId]
            );
            return res
                .map(r => this.mapRow(r))
                .filter(c => c.estado === 'PENDING' || c.estado === 'ERROR')
                .sort((a, b) => a.createdAt - b.createdAt);
        } catch (err) {
            this.logger.error('OutboxClientesService', 'Error al leer la cola', err);
            return [];
        }
    }

    /** Marca un cliente con un nuevo estado (y opcionalmente error / incremento de intentos). */
    async marcarEstado(
        id: string,
        estado: OutboxClienteEstado,
        opts: { error?: string | null; incrementarIntento?: boolean } = {}
    ): Promise<void> {
        const negocioId = this.negocioId;
        if (!negocioId) return;

        try {
            const db = await this.localDb.getDb(negocioId);
            if (opts.incrementarIntento) {
                const row = (await db.query(
                    `SELECT intentos FROM outbox_clientes WHERE id = ? LIMIT 1`,
                    [id]
                ))[0];
                const intentos = (row?.['intentos'] ?? 0) + 1;
                await db.run(
                    `UPDATE outbox_clientes SET estado = ?, ultimo_error = ?, intentos = ? WHERE id = ?`,
                    [estado, opts.error ?? null, intentos, id]
                );
            } else {
                await db.run(
                    `UPDATE outbox_clientes SET estado = ?, ultimo_error = ? WHERE id = ?`,
                    [estado, opts.error ?? null, id]
                );
            }
        } catch (err) {
            this.logger.error('OutboxClientesService', 'Error al marcar estado', err);
        }
    }

    /** Elimina un cliente de la cola (tras sincronizar con éxito). */
    async eliminar(id: string): Promise<void> {
        const negocioId = this.negocioId;
        if (!negocioId) return;

        try {
            const db = await this.localDb.getDb(negocioId);
            await db.run(`DELETE FROM outbox_clientes WHERE id = ?`, [id]);
        } catch (err) {
            this.logger.error('OutboxClientesService', 'Error al eliminar de la cola', err);
        }
    }

    private mapRow(r: { [col: string]: any }): OutboxCliente {
        return {
            id:          r['id'],
            negocioId:   r['negocio_id'],
            payload:     JSON.parse(r['payload_json']),
            estado:      r['estado'],
            intentos:    r['intentos'] ?? 0,
            ultimoError: r['ultimo_error'] ?? null,
            createdAt:   r['created_at'],
        };
    }
}
