import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { SupabaseService } from './supabase.service';
import { NetworkService } from './network.service';
import { LoggerService } from './logger.service';

/**
 * ImagenLocalService — persiste los BINARIOS de las imágenes del catálogo en disco
 * (Directory.Data) para que las fotos se muestren offline tras un cold start.
 *
 * Por qué el binario y no la signed URL (bug reportado 2026-07-06):
 *   El `signedUrlCache` de StorageService vive solo en RAM → muere cuando Android mata
 *   el proceso en reposo. Al reabrir la app sin red (vendedor de calle), no hay forma
 *   de re-firmar la URL → las fotos quedan en gris. Además una signed URL expira a los
 *   60 min: aunque se persistiera en disco, no serviría para un día entero sin red.
 *   La única solución robusta es guardar el archivo de imagen en disco y servirlo local.
 *
 * Cómo:
 *   - Clave de archivo = hash estable del path crudo de Storage (mismo path → mismo
 *     archivo local, sobrevive filtros/búsquedas/sesiones).
 *   - Descarga: online, durante el priming (Fase P) o al resolver una imagen nueva.
 *   - Lectura: `Capacitor.convertFileSrc(uri)` da una URL que `<img>` renderiza sin red.
 *
 * Solo nativo (Android/iOS). En web/PWA es no-op — ahí el navegador cachea las signed
 * URLs por HTTP y el caso "cold start offline" no aplica igual.
 */
@Injectable({ providedIn: 'root' })
export class ImagenLocalService {
    private supabase = inject(SupabaseService);
    private network  = inject(NetworkService);
    private logger   = inject(LoggerService);

    private static readonly DIR = 'catalogo-img';
    private static readonly BUCKET = 'mi-tienda';

    // Índice en memoria de qué paths ya están en disco (evita statear el FS en cada resolución).
    // Se hidrata perezosamente la primera vez y se actualiza al descargar.
    private descargadas = new Set<string>();
    // Promesa compartida de hidratación: las N resoluciones en paralelo del primer render
    // esperan el MISMO readdir en vez de cada una arrancar el suyo (o leer el Set a medio llenar).
    private hidratacion: Promise<void> | null = null;

    private get esNativo(): boolean {
        return Capacitor.isNativePlatform();
    }

    // ==========================================
    // LECTURA (offline ← disco)
    // ==========================================

    /**
     * Devuelve una URL local (convertFileSrc) si el binario de este path ya está en
     * disco; null si no. Nunca toca la red. Barato: consulta el índice en memoria y
     * solo pega al FS para construir el URI cuando hay match.
     */
    async obtenerLocal(path: string): Promise<string | null> {
        if (!this.esNativo || !path) return null;

        await this.hidratarIndice();
        const nombre = this.nombreArchivo(path);
        if (!this.descargadas.has(nombre)) return null;

        try {
            const { uri } = await Filesystem.getUri({
                path: `${ImagenLocalService.DIR}/${nombre}`,
                directory: Directory.Data,
            });
            return Capacitor.convertFileSrc(uri);
        } catch {
            // La entrada del índice quedó obsoleta (archivo borrado) — corregir y reportar miss.
            this.descargadas.delete(nombre);
            return null;
        }
    }

    // ==========================================
    // ESCRITURA (online → disco)
    // ==========================================

    /**
     * Descarga el binario de un path de Storage y lo guarda en disco (si aún no está).
     * Best-effort: nunca lanza. Retorna true si tras la llamada el binario está en disco.
     */
    async descargar(path: string): Promise<boolean> {
        if (!this.esNativo || !path) return false;
        if (!this.network.isConnected()) return false;

        await this.hidratarIndice();
        const nombre = this.nombreArchivo(path);
        if (this.descargadas.has(nombre)) return true; // ya cacheada

        try {
            const base64 = await this.descargarBase64(path);
            if (!base64) return false;

            await Filesystem.writeFile({
                path: `${ImagenLocalService.DIR}/${nombre}`,
                data: base64,
                directory: Directory.Data,
                recursive: true,
            });
            this.descargadas.add(nombre);
            return true;
        } catch (err) {
            this.logger.error('ImagenLocalService', `Error al descargar imagen ${path}`, err);
            return false;
        }
    }

    /**
     * Descarga en background todos los paths de imagen de un catálogo que aún no estén
     * en disco, y poda los binarios huérfanos (fotos cambiadas/productos borrados — sus
     * paths con UUID viejo ya no aparecen en el catálogo). Se llama desde el priming
     * (Fase P). Best-effort, en tandas para no saturar la red al arrancar.
     */
    async precargarCatalogo(paths: (string | null | undefined)[]): Promise<void> {
        if (!this.esNativo) return;
        if (!this.network.isConnected()) return;

        const unicos = [...new Set(paths.filter((p): p is string => !!p && !p.startsWith('http')))];
        // Un solo pase de hashing para todo el catálogo — se reutiliza para detectar
        // faltantes y para podar huérfanos, en vez de hashear cada path dos veces.
        const nombresVigentes = new Map(unicos.map(p => [p, this.nombreArchivo(p)]));

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

    /** Borra del disco los binarios cuyo nombre no corresponde a ningún path del catálogo actual. */
    private async podarHuerfanos(vigentes: Set<string>): Promise<void> {
        try {
            const aBorrar = [...this.descargadas].filter(nombre => !vigentes.has(nombre));
            for (const nombre of aBorrar) {
                await Filesystem.deleteFile({
                    path: `${ImagenLocalService.DIR}/${nombre}`,
                    directory: Directory.Data,
                }).catch(() => { /* ya no existe */ });
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
                // FileReader da "data:<mime>;base64,XXXX" — Filesystem quiere solo el base64.
                resolve(result.split(',')[1] ?? '');
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Nombre de archivo local estable derivado del path de Storage. Hash simple (djb2)
     * en base36 + extensión: colisiones prácticamente nulas para cientos de paths, y
     * es determinista → el mismo path siempre mapea al mismo archivo.
     */
    private nombreArchivo(path: string): string {
        let hash = 5381;
        for (let i = 0; i < path.length; i++) {
            hash = ((hash << 5) + hash + path.charCodeAt(i)) | 0;
        }
        const ext = path.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'webp';
        return `${(hash >>> 0).toString(36)}.${ext}`;
    }

    /** Lista los archivos ya descargados una sola vez y llena el índice en memoria (idempotente). */
    private hidratarIndice(): Promise<void> {
        if (!this.esNativo) return Promise.resolve();
        if (this.hidratacion) return this.hidratacion;

        this.hidratacion = (async () => {
            try {
                const { files } = await Filesystem.readdir({
                    path: ImagenLocalService.DIR,
                    directory: Directory.Data,
                });
                for (const f of files) this.descargadas.add(f.name);
            } catch {
                // El directorio aún no existe (primera vez) — índice vacío, se crea al primer writeFile.
            }
        })();
        return this.hidratacion;
    }
}
