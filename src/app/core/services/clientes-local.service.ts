import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../features/auth/services/auth.service';
import { LoggerService } from './logger.service';
import { LocalDbService } from './local-db.service';
import { Cliente } from '../../features/clientes/models/cliente.model';

/**
 * ClientesLocalService — cache de SOLO LECTURA de clientes registrados en SQLite.
 *
 * Espejo de CatalogoLocalService: se cachea el listado plano de clientes
 * (excluye consumidor final, que ya tiene su propio cache en localStorage).
 * Best-effort: nunca lanza — un fallo del cache no debe romper el flujo online.
 *
 * Cap de 5000 clientes (~1 MB JSON): suficiente para tienda minorista. Un negocio
 * que lo supere guarda solo los primeros 5000 por nombre (§4.2 PLAN-OFFLINE-CALLE).
 */
@Injectable({ providedIn: 'root' })
export class ClientesLocalService {
    private auth    = inject(AuthService);
    private logger  = inject(LoggerService);
    private localDb = inject(LocalDbService);

    private get negocioId(): string | null {
        return this.auth.usuarioActualValue?.negocio_id ?? null;
    }

    // Cache en memoria para evitar re-leer la DB y re-parsear el JSON en cada búsqueda offline.
    private memoryClientes = new Map<string, Cliente[]>();

    static readonly CAP_CLIENTES = 5000;

    // ==========================================
    // ESCRITURA (online → cache)
    // ==========================================

    /** Persiste el snapshot completo de clientes. Best-effort: nunca lanza. */
    async guardar(clientes: Cliente[]): Promise<void> {
        const negocioId = this.negocioId;
        if (!negocioId) return;

        try {
            const recorte = clientes.slice(0, ClientesLocalService.CAP_CLIENTES);
            const db = await this.localDb.getDb(negocioId);
            await db.run(
                `INSERT OR REPLACE INTO cache_clientes
                 (negocio_id, clientes_json, timestamp)
                 VALUES (?, ?, ?)`,
                [negocioId, JSON.stringify(recorte), Date.now()]
            );
            this.memoryClientes.set(negocioId, recorte);
        } catch (err) {
            this.logger.error('ClientesLocalService', 'Error al guardar clientes', err);
        }
    }

    // ==========================================
    // LECTURA (offline ← cache)
    // ==========================================

    /** Timestamp del último refresco (para el sello "actualizado: …"). */
    async obtenerTimestamp(): Promise<number | null> {
        const negocioId = this.negocioId;
        if (!negocioId) return null;
        try {
            const db  = await this.localDb.getDb(negocioId);
            const res = await db.query(
                `SELECT timestamp FROM cache_clientes WHERE negocio_id = ? LIMIT 1`,
                [negocioId]
            );
            return res[0]?.['timestamp'] ?? null;
        } catch {
            return null;
        }
    }

    private async leerClientes(): Promise<Cliente[]> {
        const negocioId = this.negocioId;
        if (!negocioId) return [];

        if (this.memoryClientes.has(negocioId)) return this.memoryClientes.get(negocioId)!;

        try {
            const db  = await this.localDb.getDb(negocioId);
            const res = await db.query(
                `SELECT clientes_json FROM cache_clientes WHERE negocio_id = ? LIMIT 1`,
                [negocioId]
            );
            const json = res[0]?.['clientes_json'];
            const clientes = json ? (JSON.parse(json) as Cliente[]) : [];
            this.memoryClientes.set(negocioId, clientes);
            return clientes;
        } catch (err) {
            this.logger.error('ClientesLocalService', 'Error al leer clientes', err);
            return [];
        }
    }

    // ==========================================
    // BÚSQUEDA EN MEMORIA (replica las RPCs offline)
    // ==========================================

    /** Replica buscarClientes offline. Filtra por nombre/identificación, límite 20. */
    async buscarPorTexto(texto: string): Promise<Cliente[]> {
        const q = texto.trim().toLowerCase();
        if (!q) return [];
        const clientes = await this.leerClientes();
        return clientes
            .filter(c =>
                c.nombre.toLowerCase().includes(q) ||
                (c.identificacion?.toLowerCase().includes(q) ?? false)
            )
            .slice(0, 20);
    }

    /** Replica buscarPorIdentificacion offline. */
    async buscarPorIdentificacion(identificacion: string): Promise<Cliente | null> {
        const clientes = await this.leerClientes();
        return clientes.find(c => c.identificacion === identificacion) ?? null;
    }

    /** Agrega un cliente al cache en memoria + disco (alta local instantánea, Fase D). */
    async agregarUno(cliente: Cliente): Promise<void> {
        const negocioId = this.negocioId;
        if (!negocioId) return;
        const actuales = await this.leerClientes();
        await this.guardar([cliente, ...actuales.filter(c => c.id !== cliente.id)]);
    }

    /** Réplica completa cacheada, ordenada por nombre (listado offline de Clientes, §4.3). */
    async obtenerTodos(): Promise<Cliente[]> {
        const clientes = await this.leerClientes();
        return [...clientes].sort((a, b) => a.nombre.localeCompare(b.nombre));
    }
}
