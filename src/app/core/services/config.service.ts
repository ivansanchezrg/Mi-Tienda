import { Injectable, inject } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { BehaviorSubject } from 'rxjs';
import { SupabaseService } from './supabase.service';
import { Configuracion, ConfiguracionRow, CONFIGURACION_DEFAULTS, mapRowsToConfig } from '../../features/configuracion/models/configuracion.model';

/**
 * Snapshot persistido en Preferences (TTL 1h).
 * El `negocio_id` permite invalidar la cache automáticamente al cambiar de tenant.
 */
interface CacheSnapshot {
    negocio_id: string | null;
    cached_at: number;      // epoch ms
    data: Configuracion;
}

@Injectable({ providedIn: 'root' })
export class ConfigService {

    private supabase = inject(SupabaseService);

    // Cache en memoria (más rápido que Preferences). Preferences se usa para cold start.
    private cache: Configuracion | null = null;
    private loadingPromise: Promise<Configuracion> | null = null;
    // Marca si ya hay un refresh de BD en vuelo (disparado por cargar() al servir
    // del cache persistido, o por revalidar()) — evita que ambos caminos disparen
    // la misma query en el mismo arranque.
    private refrescandoEnBackground = false;

    // Generación de invalidación: una carga en vuelo iniciada ANTES de invalidar()
    // no debe escribir su resultado (stale) en el cache después.
    private generation = 0;
    // Momento de la última invalidación: snapshots de Preferences anteriores se
    // rechazan aunque el remove asíncrono aún no haya aterrizado.
    private invalidatedAt = 0;

    /** TTL: 1 hora. Las configuraciones rara vez cambian; cuando lo hacen, invalidar() las limpia. */
    private readonly TTL_MS = 60 * 60 * 1000;
    private readonly STORAGE_KEY = 'mi-tienda:config-cache:v1';

    /**
     * Emite cada vez que la configuración se carga o refresca (cache, BD o revalidación
     * en background). Los consumidores que muestran flags dependientes de config
     * (sidebar, FAB del layout) se suscriben aquí para auto-corregirse cuando llega
     * un valor más fresco — sin necesidad de bloquear su render esperando la BD.
     */
    readonly config$ = new BehaviorSubject<Configuracion | null>(null);

    constructor() {
        // Limpiar cache persistida en logout/expiración. Evita que un usuario que cambia
        // de cuenta vea configs del negocio anterior durante el primer render del cold start.
        this.supabase.registerBeforeCleanup(() =>
            Preferences.remove({ key: this.STORAGE_KEY }).catch(() => {})
        );
    }

    /**
     * Carga la configuración del negocio activo.
     *
     * Estrategia (cascada por velocidad):
     *  1. RAM cache (~0ms) → si está, devuelve sync
     *  2. Preferences cache válido (~5-10ms) → si TTL no expiró Y mismo negocio_id, devuelve y refresca BD en background
     *  3. BD (~200-400ms) → query a Supabase + persiste en Preferences
     */
    async get(): Promise<Configuracion> {
        // 1. RAM hit
        if (this.cache) return this.cache;

        // Evita múltiples queries simultáneas si se llama desde varios sitios a la vez
        if (this.loadingPromise) return this.loadingPromise;

        this.loadingPromise = this.cargar();
        return this.loadingPromise;
    }

    /**
     * Lee desde Preferences si hay snapshot válido para el negocio activo;
     * caso contrario va a BD. Persiste el resultado para cold starts futuros.
     */
    private async cargar(): Promise<Configuracion> {
        const gen = this.generation;
        const negocioId = this.getNegocioIdActual();
        const desdeCache = await this.leerCachePersistido(negocioId);

        if (desdeCache) {
            // Hit: usamos cache persistido y refrescamos BD en background (stale-while-revalidate)
            if (gen === this.generation) {
                this.cache = desdeCache;
                this.loadingPromise = null;
                this.config$.next(desdeCache);
                this.refrescarDesdeBdEnBackground(negocioId);
            }
            return desdeCache;
        }

        // Miss o expirado: vamos a BD
        try {
            const rows = await this.supabase.call<ConfiguracionRow[]>(
                this.supabase.client.from('configuraciones').select('clave, valor')
            );
            const config = mapRowsToConfig(rows ?? []);
            if (gen === this.generation) {
                this.cache = config;
                this.config$.next(config);
                await this.guardarCachePersistido(negocioId, config);
            }
            return config;
        } catch {
            return CONFIGURACION_DEFAULTS;
        } finally {
            if (gen === this.generation) {
                this.loadingPromise = null;
            }
        }
    }

    /** Lectura silenciosa de Preferences. Devuelve null si no hay snapshot, expiró o cambió el negocio. */
    private async leerCachePersistido(negocioActual: string | null): Promise<Configuracion | null> {
        try {
            const { value } = await Preferences.get({ key: this.STORAGE_KEY });
            if (!value) return null;

            const snapshot: CacheSnapshot = JSON.parse(value);

            // Invalidación automática al cambiar de tenant
            if (snapshot.negocio_id !== negocioActual) return null;

            // Invalidación por TTL
            if (Date.now() - snapshot.cached_at > this.TTL_MS) return null;

            // Snapshot anterior a la última invalidar(): rechazar aunque el
            // Preferences.remove asíncrono aún no haya aterrizado (carrera)
            if (snapshot.cached_at <= this.invalidatedAt) return null;

            return snapshot.data;
        } catch {
            return null;
        }
    }

    private async guardarCachePersistido(negocioId: string | null, data: Configuracion): Promise<void> {
        const snapshot: CacheSnapshot = {
            negocio_id: negocioId,
            cached_at: Date.now(),
            data,
        };
        try {
            await Preferences.set({ key: this.STORAGE_KEY, value: JSON.stringify(snapshot) });
        } catch {
            // No es crítico si falla — solo perdemos el cache para el próximo cold start
        }
    }

    /**
     * Stale-while-revalidate: si servimos del cache persistido, refrescamos BD en background.
     * Si el snapshot estaba desactualizado, el próximo `get()` ya tendrá el valor fresco en RAM.
     */
    private refrescarDesdeBdEnBackground(negocioId: string | null): void {
        if (this.refrescandoEnBackground) return; // ya hay un refresh en vuelo, no dupliques la query
        this.refrescandoEnBackground = true;

        const gen = this.generation;
        this.supabase
            .call<ConfiguracionRow[]>(
                this.supabase.client.from('configuraciones').select('clave, valor')
            )
            .then(rows => {
                if (gen !== this.generation) return; // hubo invalidar() mientras tanto
                if (rows === null) return;           // fallo de red silenciado por call() — no pisar con vacío
                const config = mapRowsToConfig(rows);
                this.cache = config;
                this.config$.next(config);
                this.guardarCachePersistido(negocioId, config);
            })
            .catch(() => {})
            .finally(() => { this.refrescandoEnBackground = false; });
    }

    /**
     * Revalidación NO destructiva: trae la config fresca de BD en background y la
     * emite en config$, SIN borrar el cache vigente. Es el reemplazo del patrón
     * "invalidar() al montar el layout" (2026-06-11 → 2026-07-08): aquel forzaba una
     * query bloqueante a BD en cada arranque — con red mala/lenta el sidebar y el FAB
     * quedaban esperando flags durante segundos. Con revalidar(), la UI pinta del
     * cache al instante y se auto-corrige vía config$ cuando llega el valor real.
     *
     * invalidar() sigue siendo el método correcto tras una ESCRITURA de configuración
     * (el cache local es obsoleto con certeza); revalidar() es para lecturas de
     * arranque donde el cache es probablemente correcto y solo se quiere frescura.
     */
    revalidar(): void {
        this.refrescarDesdeBdEnBackground(this.getNegocioIdActual());
    }

    private getNegocioIdActual(): string | null {
        // Lee del JWT decodificado en SupabaseService (más rápido que ir al AuthService).
        // Fallback: null → cache se invalidará al cambiar negocio en el próximo cold start.
        try {
            const token = (this.supabase.client.auth as any).currentSession?.access_token;
            if (!token) return null;
            const payload = JSON.parse(atob(token.split('.')[1]));
            return payload?.app_metadata?.negocio_id ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Limpia la cache (RAM + Preferences) Y descarta cualquier carga en vuelo.
     * Llamar cuando el admin cambia una configuración desde la app, o al montar
     * una vista que exige flags frescos.
     *
     * Sin el descarte de la carga en vuelo, un get() concurrente iniciado ANTES
     * de invalidar() servía el snapshot viejo a quien llamara get() DESPUÉS
     * (bug del sidebar con flags de módulos desactualizados, 2026-06-11).
     */
    invalidar(): void {
        this.cache = null;
        this.loadingPromise = null;
        this.generation++;
        this.invalidatedAt = Date.now();
        Preferences.remove({ key: this.STORAGE_KEY }).catch(() => {});
    }
}
