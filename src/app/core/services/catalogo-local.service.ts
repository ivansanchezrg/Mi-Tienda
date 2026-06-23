import { Injectable, inject } from '@angular/core';
import { AuthService } from '../../features/auth/services/auth.service';
import { LoggerService } from './logger.service';
import { LocalDbService } from './local-db.service';
import { ProductoPOS, ProductoPresentacion } from '../../features/inventario/models/producto.model';
import { CategoriaProducto } from '../../features/inventario/models/categoria-producto.model';

/**
 * CatalogoLocalService — cache de SOLO LECTURA del catálogo del POS en SQLite.
 *
 * Se cachea el resultado aplanado de fn_catalogo_productos_pos (ProductoPOS[]),
 * NO las tablas crudas. El servidor ya hizo el trabajo de JOINs y COALESCE.
 *
 * Regla de oro: el stock cacheado es OPTIMISTA. La verdad del stock la define
 * el servidor al sincronizar la venta. El cache existe para PODER vender sin red.
 *
 * Por qué SQLite y no Preferences:
 *   Un catálogo de cientos de productos con variantes/presentaciones puede ser varios MB.
 *   Preferences serializa/deserializa todo el string de golpe — lag al abrir el POS.
 *   SQLite lo maneja sin problema y es nativo en Android/iOS.
 */
@Injectable({ providedIn: 'root' })
export class CatalogoLocalService {
    private auth   = inject(AuthService);
    private logger = inject(LoggerService);
    private localDb = inject(LocalDbService);

    private get negocioId(): string | null {
        return this.auth.usuarioActualValue?.negocio_id ?? null;
    }

    // Caché en memoria para evitar re-leer la DB y re-parsear el JSON en cada filtro offline.
    // Se invalida cuando guardar() escribe un snapshot nuevo (al volver a estar online).
    private memoryCatalogo   = new Map<string, ProductoPOS[]>();
    private memoryCategorias = new Map<string, CategoriaProducto[]>();

    // ==========================================
    // ESCRITURA (online → cache)
    // ==========================================

    /**
     * Persiste el snapshot del catálogo completo + categorías tras un fetch online exitoso.
     * Solo se llama cuando se obtiene el catálogo SIN filtro de categoría (el snapshot completo).
     * Best-effort: nunca lanza — un fallo del cache no debe romper el flujo online.
     */
    async guardar(catalogo: ProductoPOS[], categorias: CategoriaProducto[]): Promise<void> {
        const negocioId = this.negocioId;
        if (!negocioId) return;

        try {
            const db = await this.localDb.getDb(negocioId);
            await db.run(
                `INSERT OR REPLACE INTO cache_catalogo
                 (negocio_id, catalogo_json, categorias_json, timestamp)
                 VALUES (?, ?, ?, ?)`,
                [negocioId, JSON.stringify(catalogo), JSON.stringify(categorias), Date.now()]
            );
            // Actualizar caché en memoria con el snapshot fresco
            this.memoryCatalogo.set(negocioId, catalogo);
            this.memoryCategorias.set(negocioId, categorias);
        } catch (err) {
            this.logger.error('CatalogoLocalService', 'Error al guardar catálogo', err);
        }
    }

    // ==========================================
    // LECTURA (offline ← cache)
    // ==========================================

    /** True si el catálogo ya está en memoria (filtro de categoría será instantáneo). */
    tieneCacheEnMemoria(): boolean {
        const negocioId = this.negocioId;
        return !!negocioId && this.memoryCatalogo.has(negocioId);
    }

    /** True si hay un snapshot cacheado para el negocio activo. */
    async tieneCache(): Promise<boolean> {
        const negocioId = this.negocioId;
        if (!negocioId) return false;
        try {
            const db  = await this.localDb.getDb(negocioId);
            const res = await db.query(
                `SELECT 1 FROM cache_catalogo WHERE negocio_id = ? LIMIT 1`,
                [negocioId]
            );
            return res.length > 0;
        } catch {
            return false;
        }
    }

    /** Timestamp del último refresco online (para el sello "actualizado: …"). */
    async obtenerTimestamp(): Promise<number | null> {
        const negocioId = this.negocioId;
        if (!negocioId) return null;
        try {
            const db  = await this.localDb.getDb(negocioId);
            const res = await db.query(
                `SELECT timestamp FROM cache_catalogo WHERE negocio_id = ? LIMIT 1`,
                [negocioId]
            );
            return res[0]?.['timestamp'] ?? null;
        } catch {
            return null;
        }
    }

    private async leerCatalogo(): Promise<ProductoPOS[]> {
        const negocioId = this.negocioId;
        if (!negocioId) return [];

        if (this.memoryCatalogo.has(negocioId)) return this.memoryCatalogo.get(negocioId)!;

        try {
            const db  = await this.localDb.getDb(negocioId);
            const res = await db.query(
                `SELECT catalogo_json FROM cache_catalogo WHERE negocio_id = ? LIMIT 1`,
                [negocioId]
            );
            const json = res[0]?.['catalogo_json'];
            const catalogo = json ? (JSON.parse(json) as ProductoPOS[]) : [];
            this.memoryCatalogo.set(negocioId, catalogo);
            return catalogo;
        } catch (err) {
            this.logger.error('CatalogoLocalService', 'Error al leer catálogo', err);
            return [];
        }
    }

    private async leerCategorias(): Promise<CategoriaProducto[]> {
        const negocioId = this.negocioId;
        if (!negocioId) return [];

        if (this.memoryCategorias.has(negocioId)) return this.memoryCategorias.get(negocioId)!;

        try {
            const db  = await this.localDb.getDb(negocioId);
            const res = await db.query(
                `SELECT categorias_json FROM cache_catalogo WHERE negocio_id = ? LIMIT 1`,
                [negocioId]
            );
            const json = res[0]?.['categorias_json'];
            const categorias = json ? (JSON.parse(json) as CategoriaProducto[]) : [];
            this.memoryCategorias.set(negocioId, categorias);
            return categorias;
        } catch (err) {
            this.logger.error('CatalogoLocalService', 'Error al leer categorías', err);
            return [];
        }
    }

    // ==========================================
    // BÚSQUEDA EN MEMORIA (replica las RPCs offline)
    // ==========================================

    /**
     * Replica fn_catalogo_productos_pos offline.
     * Sin categoriaId → catálogo completo.
     * Con categoriaId → filtra por categoria_id efectiva (COALESCE template/producto,
     * ya resuelto en el servidor y almacenado en el snapshot).
     */
    async obtenerCatalogoPorCategoria(categoriaId?: string): Promise<ProductoPOS[]> {
        const catalogo = await this.leerCatalogo();
        if (!categoriaId) return catalogo;
        return catalogo.filter(p => p.categoria_id === categoriaId);
    }

    /**
     * Replica fn_buscar_productos_pos offline.
     * Búsqueda ILIKE '%texto%' en nombre y código de barras. Límite 20 igual que la RPC.
     */
    async buscarPorTexto(texto: string): Promise<ProductoPOS[]> {
        const q = texto.trim().toLowerCase();
        if (!q) return [];
        const catalogo = await this.leerCatalogo();
        return catalogo
            .filter(p =>
                p.nombre.toLowerCase().includes(q) ||
                (p.codigo_barras?.toLowerCase().includes(q) ?? false)
            )
            .slice(0, 20);
    }

    /**
     * Replica buscarPorCodigoBarras offline.
     * Lookup dual: busca el código en el producto y en las presentaciones anidadas.
     * Las presentaciones ya vienen en el snapshot, sin necesidad de queries adicionales.
     */
    async buscarPorCodigoBarras(codigo: string): Promise<{ producto: ProductoPOS; presentacion?: ProductoPresentacion } | null> {
        const cod = codigo.trim();
        if (!cod) return null;
        const catalogo = await this.leerCatalogo();

        // 1. Match directo en el producto
        const prod = catalogo.find(p => p.codigo_barras === cod);
        if (prod) return { producto: prod };

        // 2. Match en presentaciones anidadas
        for (const p of catalogo) {
            const pres = p.presentaciones?.find(pr => pr.codigo_barras === cod && pr.activo);
            if (pres) return { producto: p, presentacion: pres };
        }
        return null;
    }

    /** Categorías cacheadas (para el filtro offline del POS). */
    async obtenerCategorias(): Promise<CategoriaProducto[]> {
        return this.leerCategorias();
    }
}
