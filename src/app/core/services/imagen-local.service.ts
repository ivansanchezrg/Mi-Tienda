import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { SupabaseService } from './supabase.service';
import { NetworkService } from './network.service';
import { LoggerService } from './logger.service';

/**
 * ImagenLocalService — persiste los BINARIOS de las imágenes del catálogo localmente
 * para que las fotos se muestren offline (incluso tras un cold start / reapertura sin
 * red). Es multiplataforma: usa el motor de almacenamiento propio de cada plataforma
 * detrás de una interfaz común (ImagenStore), sin que los callers lo noten.
 *
 *   Android / iOS → Capacitor Filesystem (Directory.Data)  → FilesystemStore
 *   Web / PWA     → IndexedDB (object store de blobs)       → IndexedDbStore
 *
 * Por qué el binario y no la signed URL (bug reportado 2026-07-06 en nativo; 2026-07-14
 * en web):
 *   El `signedUrlCache` de StorageService vive solo en RAM → muere cuando el SO mata el
 *   proceso (nativo) o al recargar la pestaña (web). Sin red no hay forma de re-firmar
 *   → las fotos quedan en gris. Además una signed URL expira a los 60 min. En web el
 *   HTTP cache del navegador solo ayuda para imágenes YA renderizadas antes — una foto
 *   que nunca se pintó (p.ej. la de una variante dentro de un modal que no abriste) no
 *   está en ningún cache → gris offline. La única solución robusta y simétrica en ambas
 *   plataformas es guardar el archivo de imagen localmente y servirlo sin red.
 *
 * Cómo:
 *   - Clave de archivo = hash estable del path crudo de Storage (mismo path → misma
 *     clave local, sobrevive filtros/búsquedas/sesiones).
 *   - Descarga: online, durante el priming (Fase P) o al resolver una imagen nueva.
 *   - Lectura nativa: `Capacitor.convertFileSrc(uri)` → URL que `<img>` renderiza sin red.
 *   - Lectura web: `URL.createObjectURL(blob)` desde IndexedDB → misma idea.
 */

/**
 * Interfaz de almacenamiento de binarios que abstrae la plataforma. Cada método es
 * best-effort: nunca lanza, retorna null/false ante fallo. La clave (`nombre`) es el
 * hash estable del path — el store no conoce paths de Storage, solo claves opacas.
 */
interface ImagenStore {
    /** URL local lista para `<img [src]>` si el binario existe; null si no. Sin red. */
    obtener(nombre: string, ext: string): Promise<string | null>;
    /** Persiste el binario (base64) bajo `nombre`. Retorna true si quedó guardado. */
    guardar(nombre: string, ext: string, base64: string): Promise<boolean>;
    /** Nombres de todos los binarios ya persistidos (para índice y poda de huérfanos). */
    listar(): Promise<string[]>;
    /** Borra el binario `nombre`. Best-effort, no lanza si no existe. */
    borrar(nombre: string): Promise<void>;
}

// ── Adaptador nativo (Android / iOS) — Capacitor Filesystem ──────────────────

class FilesystemStore implements ImagenStore {
    private static readonly DIR = 'catalogo-img';

    // Cache RAM del URI convertido (nombre → convertFileSrc). Filesystem.getUri es una
    // llamada al bridge nativo POR imagen; con catálogos grandes y republicaciones
    // frecuentes del grid eso son cientos de idas al bridge para un valor estable.
    private uriCache = new Map<string, string>();

    async obtener(nombre: string): Promise<string | null> {
        const cacheado = this.uriCache.get(nombre);
        if (cacheado) return cacheado;
        try {
            const { uri } = await Filesystem.getUri({
                path: `${FilesystemStore.DIR}/${nombre}`,
                directory: Directory.Data,
            });
            const url = Capacitor.convertFileSrc(uri);
            this.uriCache.set(nombre, url);
            return url;
        } catch {
            return null; // no existe (o entrada de índice obsoleta) — el caller lo maneja
        }
    }

    async guardar(nombre: string, _ext: string, base64: string): Promise<boolean> {
        await Filesystem.writeFile({
            path: `${FilesystemStore.DIR}/${nombre}`,
            data: base64,
            directory: Directory.Data,
            recursive: true,
        });
        return true;
    }

    async listar(): Promise<string[]> {
        try {
            const { files } = await Filesystem.readdir({
                path: FilesystemStore.DIR,
                directory: Directory.Data,
            });
            return files.map(f => f.name);
        } catch {
            return []; // el directorio aún no existe (primera vez) — índice vacío
        }
    }

    async borrar(nombre: string): Promise<void> {
        await Filesystem.deleteFile({
            path: `${FilesystemStore.DIR}/${nombre}`,
            directory: Directory.Data,
        }).catch(() => { /* ya no existe */ });
        this.uriCache.delete(nombre);
    }
}

// ── Adaptador web (Web / PWA) — IndexedDB con blobs ──────────────────────────
// Un object store dedicado a binarios de imagen, con la clave (hash del path) como
// keyPath. Guarda Blobs directamente (IndexedDB los soporta nativamente) y expone
// object URLs para `<img>`. NO se apoya en LocalDbService a propósito: ese motor es
// "SQL-like" para filas de texto/JSON (outbox, snapshots); los blobs pesados merecen
// su propia DB para no mezclar datos transaccionales con binarios.

class IndexedDbStore implements ImagenStore {
    private static readonly DB   = 'mi-tienda-img';
    private static readonly STORE = 'binarios';
    private static readonly VERSION = 1;

    private dbPromise: Promise<IDBDatabase> | null = null;
    // Cache RAM del object URL por nombre. createObjectURL crea una entrada nueva cada
    // llamada (fuga de memoria si se repite) → se reutiliza y solo se revoca al borrar.
    private objectUrlCache = new Map<string, string>();

    private open(): Promise<IDBDatabase> {
        if (this.dbPromise) return this.dbPromise;
        this.dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(IndexedDbStore.DB, IndexedDbStore.VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IndexedDbStore.STORE)) {
                    db.createObjectStore(IndexedDbStore.STORE); // clave externa (nombre)
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return this.dbPromise;
    }

    async obtener(nombre: string): Promise<string | null> {
        const cacheado = this.objectUrlCache.get(nombre);
        if (cacheado) return cacheado;
        try {
            const db = await this.open();
            const blob = await new Promise<Blob | null>((resolve, reject) => {
                const tx = db.transaction(IndexedDbStore.STORE, 'readonly');
                const req = tx.objectStore(IndexedDbStore.STORE).get(nombre);
                req.onsuccess = () => resolve((req.result as Blob) ?? null);
                req.onerror = () => reject(req.error);
            });
            if (!blob) return null;
            const url = URL.createObjectURL(blob);
            this.objectUrlCache.set(nombre, url);
            return url;
        } catch {
            return null;
        }
    }

    async guardar(nombre: string, ext: string, base64: string): Promise<boolean> {
        const blob = this.base64ABlob(base64, ext);
        const db = await this.open();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(IndexedDbStore.STORE, 'readwrite');
            tx.objectStore(IndexedDbStore.STORE).put(blob, nombre);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        return true;
    }

    async listar(): Promise<string[]> {
        try {
            const db = await this.open();
            return await new Promise<string[]>((resolve, reject) => {
                const tx = db.transaction(IndexedDbStore.STORE, 'readonly');
                const req = tx.objectStore(IndexedDbStore.STORE).getAllKeys();
                req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
                req.onerror = () => reject(req.error);
            });
        } catch {
            return [];
        }
    }

    async borrar(nombre: string): Promise<void> {
        const url = this.objectUrlCache.get(nombre);
        if (url) { URL.revokeObjectURL(url); this.objectUrlCache.delete(nombre); }
        try {
            const db = await this.open();
            await new Promise<void>((resolve) => {
                const tx = db.transaction(IndexedDbStore.STORE, 'readwrite');
                tx.objectStore(IndexedDbStore.STORE).delete(nombre);
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve(); // best-effort
            });
        } catch { /* best-effort */ }
    }

    /** base64 (sin prefijo data:) + extensión → Blob con el mime correcto. */
    private base64ABlob(base64: string, ext: string): Blob {
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const mime = ext === 'png' ? 'image/png'
            : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : 'image/webp';
        return new Blob([bytes], { type: mime });
    }
}

// ── Servicio ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class ImagenLocalService {
    private supabase = inject(SupabaseService);
    private network  = inject(NetworkService);
    private logger   = inject(LoggerService);

    private static readonly BUCKET = 'mi-tienda';

    /** Motor de almacenamiento según plataforma — elegido una vez al construir. */
    private readonly store: ImagenStore =
        Capacitor.isNativePlatform() ? new FilesystemStore() : new IndexedDbStore();

    // Índice en memoria de qué claves ya están persistidas (evita statear el store en
    // cada resolución). Se hidrata perezosamente la primera vez y se actualiza al guardar.
    private descargadas = new Set<string>();
    // Promesa compartida de hidratación: las N resoluciones en paralelo del primer render
    // esperan el MISMO listar() en vez de cada una arrancar el suyo (o leer el Set a medio llenar).
    private hidratacion: Promise<void> | null = null;

    // ==========================================
    // LECTURA (offline ← local)
    // ==========================================

    /**
     * Devuelve una URL local si el binario de este path ya está persistido; null si no.
     * Nunca toca la red. Barato: consulta el índice en memoria y solo pega al store para
     * construir la URL cuando hay match.
     */
    async obtenerLocal(path: string): Promise<string | null> {
        if (!path) return null;

        await this.hidratarIndice();
        const { nombre, ext } = this.claveArchivo(path);
        if (!this.descargadas.has(nombre)) return null;

        const url = await this.store.obtener(nombre, ext);
        if (!url) {
            // La entrada del índice quedó obsoleta (binario borrado) — corregir y reportar miss.
            this.descargadas.delete(nombre);
        }
        return url;
    }

    // ==========================================
    // ESCRITURA (online → local)
    // ==========================================

    /**
     * Descarga el binario de un path de Storage y lo persiste localmente (si aún no está).
     * Best-effort: nunca lanza. Retorna true si tras la llamada el binario está local.
     */
    async descargar(path: string): Promise<boolean> {
        if (!path) return false;
        if (!this.network.isConnected()) return false;

        await this.hidratarIndice();
        const { nombre, ext } = this.claveArchivo(path);
        if (this.descargadas.has(nombre)) return true; // ya cacheada

        try {
            const base64 = await this.descargarBase64(path);
            if (!base64) return false;

            const ok = await this.store.guardar(nombre, ext, base64);
            if (ok) this.descargadas.add(nombre);
            return ok;
        } catch (err) {
            this.logger.error('ImagenLocalService', `Error al descargar imagen ${path}`, err);
            return false;
        }
    }

    /**
     * Descarga en background todos los paths de imagen de un catálogo que aún no estén
     * persistidos, y poda los binarios huérfanos (fotos cambiadas/productos borrados — sus
     * paths con UUID viejo ya no aparecen en el catálogo). Se llama desde el priming
     * (Fase P). Best-effort, en tandas para no saturar la red al arrancar.
     */
    async precargarCatalogo(paths: (string | null | undefined)[]): Promise<void> {
        if (!this.network.isConnected()) return;

        const unicos = [...new Set(paths.filter((p): p is string => !!p && !p.startsWith('http')))];
        // Un solo pase de hashing para todo el catálogo — se reutiliza para detectar
        // faltantes y para podar huérfanos, en vez de hashear cada path dos veces.
        const nombresVigentes = new Map(unicos.map(p => [p, this.claveArchivo(p).nombre]));

        await this.hidratarIndice();

        const faltantes = unicos.filter(p => !this.descargadas.has(nombresVigentes.get(p)!));

        // Tandas de 5 para no abrir 200 requests de golpe en el arranque.
        const LOTE = 5;
        for (let i = 0; i < faltantes.length; i += LOTE) {
            if (!this.network.isConnected()) break;
            await Promise.all(faltantes.slice(i, i + LOTE).map(p => this.descargar(p)));
        }

        await this.podarHuerfanos(new Set(nombresVigentes.values()));
    }

    /** Borra los binarios cuya clave no corresponde a ningún path del catálogo actual. */
    private async podarHuerfanos(vigentes: Set<string>): Promise<void> {
        try {
            const aBorrar = [...this.descargadas].filter(nombre => !vigentes.has(nombre));
            for (const nombre of aBorrar) {
                await this.store.borrar(nombre);
                this.descargadas.delete(nombre);
            }
        } catch (err) {
            this.logger.error('ImagenLocalService', 'Error al podar imágenes huérfanas', err);
        }
    }

    // ==========================================
    // HELPERS
    // ==========================================

    /** Baja el binario de Storage como base64 vía la signed URL (usa fetch, no el SDK). */
    private async descargarBase64(path: string): Promise<string | null> {
        const { data, error } = await this.supabase.client.storage
            .from(ImagenLocalService.BUCKET)
            .createSignedUrl(path, 60);
        if (error || !data?.signedUrl) return null;

        const resp = await fetch(data.signedUrl);
        if (!resp.ok) return null;
        const blob = await resp.blob();
        return this.blobABase64(blob);
    }

    private blobABase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                // FileReader da "data:<mime>;base64,XXXX" — se quiere solo el base64.
                resolve(result.split(',')[1] ?? '');
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Clave de almacenamiento estable derivada del path de Storage: hash simple (djb2)
     * en base36 + extensión. Colisiones prácticamente nulas para cientos de paths, y es
     * determinista → el mismo path siempre mapea a la misma clave. La extensión viaja
     * aparte porque el store web la necesita para el mime del Blob.
     */
    private claveArchivo(path: string): { nombre: string; ext: string } {
        let hash = 5381;
        for (let i = 0; i < path.length; i++) {
            hash = ((hash << 5) + hash + path.charCodeAt(i)) | 0;
        }
        const ext = path.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'webp';
        return { nombre: `${(hash >>> 0).toString(36)}.${ext}`, ext };
    }

    /** Lista los binarios ya persistidos una sola vez y llena el índice en memoria (idempotente). */
    private hidratarIndice(): Promise<void> {
        if (this.hidratacion) return this.hidratacion;

        this.hidratacion = (async () => {
            const nombres = await this.store.listar();
            for (const n of nombres) this.descargadas.add(n);
        })();
        return this.hidratacion;
    }
}
