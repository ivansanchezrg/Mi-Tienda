import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../features/auth/services/auth.service';
import { LoggerService } from './logger.service';
import { LocalDbService } from './local-db.service';

/** Snapshot del turno abierto guardado en local — habilita cobrar offline. */
export interface TurnoLocalSnapshot {
    turnoId: string;
    empleadoId: string;
    numeroTurno: number;
    abiertoAt: number;
}

/**
 * TurnoLocalService — snapshot del turno YA ABIERTO en SQLite/IndexedDB local.
 *
 * Por qué existe (bloqueador del cobro offline, §4.6 del PLAN-OFFLINE-POS):
 *   procesarVenta() y cajaAbiertaGuard consultaban el servidor por el turno antes
 *   de cada venta / al entrar al POS. Sin red devuelven null → la venta se rechaza
 *   y el guard bloquea el POS aunque haya un turno abierto. El snapshot local rompe
 *   esa dependencia: el turno_id vive en local mientras el turno está abierto.
 *
 * Ciclo de vida (siempre online en los extremos):
 *   - Se ESCRIBE al abrir turno (fn_abrir_turno OK).
 *   - Se LEE al cobrar (offline) y al entrar al POS sin red (guard).
 *   - Se BORRA al cerrar turno (fn_ejecutar_cierre_diario OK).
 *
 * Regla anti-fantasma: sin fila en turno_activo_local no se puede cobrar offline.
 * Combinado con la barrera del cierre (§4.7), nunca se cobra sobre un turno cerrado.
 *
 * Multi-tenant: una fila por negocio_id (modelo mono-caja, un turno abierto por negocio).
 * Best-effort en escritura: un fallo del cache local nunca rompe el flujo online.
 */
@Injectable({ providedIn: 'root' })
export class TurnoLocalService {
    private auth    = inject(AuthService);
    private logger  = inject(LoggerService);
    private localDb = inject(LocalDbService);

    private get negocioId(): string | null {
        return this.auth.usuarioActualValue?.negocio_id ?? null;
    }

    /** Persiste el snapshot del turno abierto. Best-effort: nunca lanza. */
    async guardar(snapshot: TurnoLocalSnapshot): Promise<void> {
        const negocioId = this.negocioId;
        if (!negocioId) return;

        try {
            const db = await this.localDb.getDb(negocioId);
            await db.run(
                `INSERT OR REPLACE INTO turno_activo_local
                 (negocio_id, turno_id, empleado_id, numero_turno, abierto_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [negocioId, snapshot.turnoId, snapshot.empleadoId, snapshot.numeroTurno, snapshot.abiertoAt]
            );
        } catch (err) {
            this.logger.error('TurnoLocalService', 'Error al guardar snapshot del turno', err);
        }
    }

    /** Lee el snapshot del turno abierto, o null si no hay. */
    async obtener(): Promise<TurnoLocalSnapshot | null> {
        const negocioId = this.negocioId;
        if (!negocioId) return null;

        try {
            const db  = await this.localDb.getDb(negocioId);
            const res = await db.query(
                `SELECT turno_id, empleado_id, numero_turno, abierto_at
                 FROM turno_activo_local WHERE negocio_id = ? LIMIT 1`,
                [negocioId]
            );
            const row = res[0];
            if (!row) return null;
            return {
                turnoId:     row['turno_id'],
                empleadoId:  row['empleado_id'],
                numeroTurno: row['numero_turno'],
                abiertoAt:   row['abierto_at'],
            };
        } catch (err) {
            this.logger.error('TurnoLocalService', 'Error al leer snapshot del turno', err);
            return null;
        }
    }

    /** Borra el snapshot (al cerrar turno). Best-effort: nunca lanza. */
    async borrar(): Promise<void> {
        const negocioId = this.negocioId;
        if (!negocioId) return;

        try {
            const db = await this.localDb.getDb(negocioId);
            await db.run(`DELETE FROM turno_activo_local WHERE negocio_id = ?`, [negocioId]);
        } catch (err) {
            this.logger.error('TurnoLocalService', 'Error al borrar snapshot del turno', err);
        }
    }
}
