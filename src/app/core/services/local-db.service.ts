import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
} from '@capacitor-community/sqlite';
import { LoggerService } from './logger.service';

/**
 * LocalDbService — capa de abstracción de almacenamiento local para modo offline.
 *
 * Estrategia por plataforma (sin jeep-sqlite en web — bug de WebAssembly conocido):
 *   Android / iOS  → SQLite nativo vía @capacitor-community/sqlite  ✅
 *   Web / PWA      → IndexedDB nativo del browser (sin jeep-sqlite)  ✅
 *
 * API pública uniforme: run(), query(), execute() — igual en ambas plataformas.
 * CatalogoLocalService, OutboxService y TurnoLocalService no saben qué motor usan.
 *
 * Multi-tenant: una DB/store por negocio_id.
 * Esquema: outbox_ventas | turno_activo_local | cache_catalogo
 */

// ── Interfaz común ──────────────────────────────────────────────────────────

export interface DbRow { [col: string]: any; }

export interface IDbAdapter {
    run(sql: string, params?: any[]): Promise<void>;
    query(sql: string, params?: any[]): Promise<DbRow[]>;
    execute(sql: string): Promise<void>;
    close(): Promise<void>;
}

// ── Esquema (mismo para ambos motores) ──────────────────────────────────────

const TABLES: Record<string, string> = {
    outbox_ventas: `
        idempotency_key TEXT PRIMARY KEY,
        negocio_id      TEXT NOT NULL,
        turno_id        TEXT NOT NULL,
        payload_json    TEXT NOT NULL,
        estado          TEXT NOT NULL DEFAULT 'PENDING',
        intentos        INTEGER NOT NULL DEFAULT 0,
        ultimo_error    TEXT,
        created_at      INTEGER NOT NULL`,

    turno_activo_local: `
        negocio_id   TEXT PRIMARY KEY,
        turno_id     TEXT NOT NULL,
        empleado_id  TEXT NOT NULL,
        numero_turno INTEGER NOT NULL,
        abierto_at   INTEGER NOT NULL`,

    cache_catalogo: `
        negocio_id      TEXT PRIMARY KEY,
        catalogo_json   TEXT NOT NULL,
        categorias_json TEXT NOT NULL,
        timestamp       INTEGER NOT NULL`,
};

const SCHEMA_VERSION = 1;

// ── Adaptador SQLite (Android / iOS) ────────────────────────────────────────

class SQLiteAdapter implements IDbAdapter {
    constructor(private db: any, private logger: LoggerService) {}

    async run(sql: string, params: any[] = []): Promise<void> {
        await this.db.run(sql, params);
    }

    async query(sql: string, params: any[] = []): Promise<DbRow[]> {
        const res = await this.db.query(sql, params);
        return res.values ?? [];
    }

    async execute(sql: string): Promise<void> {
        await this.db.execute(sql);
    }

    async close(): Promise<void> {
        try { await this.db.close(); } catch { /* best-effort */ }
    }
}

// ── Adaptador IndexedDB (Web / PWA) ─────────────────────────────────────────
// Implementa un motor SQL-like sobre IndexedDB usando un object store por tabla.
// Cada registro usa su clave primaria como keyPath.
// Soporta el subconjunto de SQL que usan CatalogoLocalService, OutboxService y TurnoLocalService.

class IndexedDbAdapter implements IDbAdapter {
    private db!: IDBDatabase;

    static async open(dbName: string, tables: Record<string, string>, version: number, logger: LoggerService): Promise<IndexedDbAdapter> {
        const adapter = new IndexedDbAdapter(logger);
        await adapter._open(dbName, tables, version);
        return adapter;
    }

    constructor(private logger: LoggerService) {}

    private _open(dbName: string, tables: Record<string, string>, version: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(dbName, version);

            req.onupgradeneeded = () => {
                const db = req.result;
                // Cada tabla → un object store con keyPath = primera columna PRIMARY KEY
                const primaryKeys: Record<string, string> = {
                    outbox_ventas:       'idempotency_key',
                    turno_activo_local:  'negocio_id',
                    cache_catalogo:      'negocio_id',
                };
                for (const table of Object.keys(tables)) {
                    if (!db.objectStoreNames.contains(table)) {
                        db.createObjectStore(table, { keyPath: primaryKeys[table] });
                    }
                }
            };

            req.onsuccess  = () => { this.db = req.result; resolve(); };
            req.onerror    = () => reject(req.error);
        });
    }

    // run() — soporta INSERT OR REPLACE, INSERT, UPDATE, DELETE
    async run(sql: string, params: any[] = []): Promise<void> {
        const upper = sql.trim().toUpperCase();

        if (upper.startsWith('INSERT OR REPLACE') || upper.startsWith('INSERT')) {
            const table = this._parseTable(sql, /INTO\s+(\w+)/i);
            const cols  = this._parseCols(sql);
            const obj: DbRow = {};
            cols.forEach((c, i) => obj[c] = params[i]);
            await this._idbPut(table, obj);
            return;
        }

        if (upper.startsWith('UPDATE')) {
            const table = this._parseTable(sql, /UPDATE\s+(\w+)/i);
            const { setCols, whereCol, whereVal } = this._parseUpdate(sql, params);
            const existing = await this._idbGetByKey(table, whereVal);
            if (existing) {
                setCols.forEach(({ col, val }) => existing[col] = val);
                await this._idbPut(table, existing);
            }
            return;
        }

        if (upper.startsWith('DELETE')) {
            const table    = this._parseTable(sql, /FROM\s+(\w+)/i);
            const whereCol = this._parseWhereCol(sql);
            if (whereCol && params[0] !== undefined) {
                const store = this._txStore(table, 'readwrite');
                // Si el WHERE es por la keyPath, borramos directamente
                const keyPath = (store as any).keyPath as string;
                if (whereCol === keyPath) {
                    await this._promisify(store.delete(params[0]));
                } else {
                    // WHERE en columna no-key: getAll + filtrar + borrar
                    const all = await this._idbGetAll(table);
                    for (const rec of all) {
                        if (rec[whereCol] === params[0]) {
                            const store2 = this._txStore(table, 'readwrite');
                            const kp = (store2 as any).keyPath as string;
                            await this._promisify(store2.delete(rec[kp]));
                        }
                    }
                }
            }
            return;
        }

        this.logger.warn('IndexedDbAdapter', `run() no soporta: ${sql.substring(0, 60)}`);
    }

    // query() — soporta SELECT con WHERE simple (columna = ?) o sin WHERE
    async query(sql: string, params: any[] = []): Promise<DbRow[]> {
        const table    = this._parseTable(sql, /FROM\s+(\w+)/i);
        const whereCol = this._parseWhereCol(sql);
        const limit    = this._parseLimit(sql);

        let rows = await this._idbGetAll(table);

        if (whereCol && params[0] !== undefined) {
            rows = rows.filter(r => r[whereCol] === params[0]);
        }

        if (limit !== null) rows = rows.slice(0, limit);
        return rows;
    }

    // execute() — para CREATE TABLE (no-op en IndexedDB, el schema ya se creó en open)
    async execute(_sql: string): Promise<void> { /* schema creado en onupgradeneeded */ }

    async close(): Promise<void> {
        try { this.db?.close(); } catch { /* best-effort */ }
    }

    // ── helpers privados ────────────────────────────────────────────────────

    private _parseTable(sql: string, re: RegExp): string {
        const m = sql.match(re);
        if (!m) throw new Error(`IndexedDbAdapter: no se pudo parsear tabla de: ${sql}`);
        return m[1];
    }

    private _parseCols(sql: string): string[] {
        const m = sql.match(/\(([^)]+)\)\s*VALUES/i);
        if (!m) return [];
        return m[1].split(',').map(c => c.trim());
    }

    private _parseUpdate(sql: string, params: any[]): { setCols: { col: string; val: any }[]; whereCol: string; whereVal: any } {
        const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/is);
        const setCols: { col: string; val: any }[] = [];
        let paramIdx = 0;
        if (setMatch) {
            setMatch[1].split(',').forEach(part => {
                const col = part.split('=')[0].trim();
                setCols.push({ col, val: params[paramIdx++] });
            });
        }
        const whereCol  = this._parseWhereCol(sql) ?? '';
        const whereVal  = params[paramIdx];
        return { setCols, whereCol, whereVal };
    }

    private _parseWhereCol(sql: string): string | null {
        const m = sql.match(/WHERE\s+(\w+)\s*=/i);
        return m ? m[1] : null;
    }

    private _parseLimit(sql: string): number | null {
        const m = sql.match(/LIMIT\s+(\d+)/i);
        return m ? parseInt(m[1], 10) : null;
    }

    private _txStore(table: string, mode: IDBTransactionMode): IDBObjectStore {
        return this.db.transaction(table, mode).objectStore(table);
    }

    private async _idbPut(table: string, obj: DbRow): Promise<void> {
        await this._promisify(this._txStore(table, 'readwrite').put(obj));
    }

    private async _idbGetByKey(table: string, key: any): Promise<DbRow | null> {
        const res = await this._promisify<DbRow>(this._txStore(table, 'readonly').get(key));
        return res ?? null;
    }

    private _idbGetAll(table: string): Promise<DbRow[]> {
        return this._promisify<DbRow[]>(this._txStore(table, 'readonly').getAll() as IDBRequest<DbRow[]>);
    }

    private _promisify<T = void>(req: IDBRequest<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror   = () => reject(req.error);
        });
    }
}

// ── Servicio principal ───────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class LocalDbService {
    private sqlite   = new SQLiteConnection(CapacitorSQLite);
    private adapters = new Map<string, IDbAdapter>();
    private initMap  = new Map<string, Promise<IDbAdapter>>();

    constructor(private logger: LoggerService) {}

    /**
     * Obtiene (o crea) el adaptador para el negocio dado.
     * Idempotente — llamadas concurrentes esperan la misma promesa.
     */
    async getDb(negocioId: string): Promise<IDbAdapter> {
        if (this.adapters.has(negocioId)) return this.adapters.get(negocioId)!;

        if (!this.initMap.has(negocioId)) {
            this.initMap.set(negocioId, this._open(negocioId));
        }

        const adapter = await this.initMap.get(negocioId)!;
        this.adapters.set(negocioId, adapter);
        this.initMap.delete(negocioId);
        return adapter;
    }

    private async _open(negocioId: string): Promise<IDbAdapter> {
        const platform = Capacitor.getPlatform();
        const dbName   = `mi_tienda_${negocioId}`;

        try {
            if (platform === 'web') {
                // IndexedDB nativo — sin jeep-sqlite, sin WebAssembly
                const adapter = await IndexedDbAdapter.open(dbName, TABLES, SCHEMA_VERSION, this.logger);
                this.logger.info('LocalDbService', `DB "${dbName}" lista en web (IndexedDB)`);
                return adapter;
            }

            // Android / iOS — SQLite nativo
            const db = await this.sqlite.createConnection(dbName, false, 'no-encryption', SCHEMA_VERSION, false);
            await db.open();

            // Crear tablas
            const schemaSql = Object.entries(TABLES)
                .map(([t, cols]) => `CREATE TABLE IF NOT EXISTS ${t} (${cols});`)
                .join('\n');
            await db.execute(schemaSql);

            this.logger.info('LocalDbService', `DB "${dbName}" lista en ${platform} (SQLite)`);
            return new SQLiteAdapter(db, this.logger);

        } catch (err) {
            this.logger.error('LocalDbService', `Error al abrir DB "${dbName}"`, err);
            throw err;
        }
    }

    async closeDb(negocioId: string): Promise<void> {
        const adapter = this.adapters.get(negocioId);
        if (!adapter) return;
        await adapter.close();
        this.adapters.delete(negocioId);
    }
}
