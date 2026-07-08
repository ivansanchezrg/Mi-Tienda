import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../features/auth/services/auth.service';
import { LoggerService } from './logger.service';
import { LocalDbService } from './local-db.service';
import { Venta } from '../../features/ventas/models/venta.model';
import { getFechaLocal } from '../utils/date.util';

/**
 * VentasLocalService — cache de SOLO LECTURA de la primera página del listado
 * de ventas del día actual (tab "Lista" de Ventas, §5 PLAN-OFFLINE-CALLE).
 *
 * Solo guarda la vista default: filtro 'hoy', página 0, sin búsqueda/estado/turno.
 * Un fetch filtrado no debe sobrescribir este snapshot (mismo criterio que el
 * catálogo POS — "solo el completo refresca").
 *
 * Se invalida por fecha: si el día local cambió, el snapshot es de ayer y no se sirve.
 */
@Injectable({ providedIn: 'root' })
export class VentasLocalService {
    private auth    = inject(AuthService);
    private logger  = inject(LoggerService);
    private localDb = inject(LocalDbService);

    private get negocioId(): string | null {
        return this.auth.usuarioActualValue?.negocio_id ?? null;
    }

    /** Persiste el snapshot de la página 1 del día. Best-effort: nunca lanza. */
    async guardar(ventas: Venta[]): Promise<void> {
        const negocioId = this.negocioId;
        if (!negocioId) return;

        try {
            const db = await this.localDb.getDb(negocioId);
            await db.run(
                `INSERT OR REPLACE INTO cache_ventas_dia
                 (negocio_id, fecha, ventas_json, timestamp)
                 VALUES (?, ?, ?, ?)`,
                [negocioId, getFechaLocal(), JSON.stringify(ventas), Date.now()]
            );
        } catch (err) {
            this.logger.error('VentasLocalService', 'Error al guardar ventas del día', err);
        }
    }

    /** Snapshot de hoy si existe y es del día actual; [] si no hay o es de otro día. */
    async obtener(): Promise<Venta[]> {
        const negocioId = this.negocioId;
        if (!negocioId) return [];

        try {
            const db  = await this.localDb.getDb(negocioId);
            const res = await db.query(
                `SELECT fecha, ventas_json FROM cache_ventas_dia WHERE negocio_id = ? LIMIT 1`,
                [negocioId]
            );
            const row = res[0];
            if (!row || row['fecha'] !== getFechaLocal()) return [];
            return JSON.parse(row['ventas_json']) as Venta[];
        } catch (err) {
            this.logger.error('VentasLocalService', 'Error al leer ventas del día', err);
            return [];
        }
    }

    /** Timestamp del último refresco (para el sello "actualizado: …"). Null si es de otro día. */
    async obtenerTimestamp(): Promise<number | null> {
        const negocioId = this.negocioId;
        if (!negocioId) return null;
        try {
            const db  = await this.localDb.getDb(negocioId);
            const res = await db.query(
                `SELECT fecha, timestamp FROM cache_ventas_dia WHERE negocio_id = ? LIMIT 1`,
                [negocioId]
            );
            const row = res[0];
            if (!row || row['fecha'] !== getFechaLocal()) return null;
            return row['timestamp'] ?? null;
        } catch {
            return null;
        }
    }
}
