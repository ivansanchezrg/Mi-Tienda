import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { Configuracion, ConfiguracionRow, CONFIGURACION_DEFAULTS, mapRowsToConfig } from '../../features/configuracion/models/configuracion.model';

@Injectable({ providedIn: 'root' })
export class ConfigService {

    private supabase = inject(SupabaseService);

    private cache: Configuracion | null = null;
    private loadingPromise: Promise<Configuracion> | null = null;
    private realtimeChannel: RealtimeChannel | null = null;

    /** Emite cada vez que pos_habilitado cambia. Permite reaccionar sin recargar la app. */
    readonly posHabilitado$ = new BehaviorSubject<boolean>(true);

    /** Carga una sola vez por sesión y cachea en memoria. */
    async get(): Promise<Configuracion> {
        if (this.cache) return this.cache;

        // Evita múltiples queries simultáneas si se llama desde varios sitios a la vez
        if (!this.loadingPromise) {
            this.loadingPromise = this.supabase
                .call<ConfiguracionRow[]>(
                    this.supabase.client.from('configuraciones').select('clave, valor')
                )
                .then(rows => {
                    this.cache = this.mapRowsToConfig(rows ?? []);
                    this.posHabilitado$.next(this.cache.pos_habilitado);
                    this.loadingPromise = null;
                    this.iniciarRealtime();
                    return this.cache;
                })
                .catch(() => {
                    this.loadingPromise = null;
                    return CONFIGURACION_DEFAULTS;
                });
        }

        return this.loadingPromise;
    }

    /** Shortcut directo para el nombre del negocio */
    async getNombreNegocio(): Promise<string> {
        return (await this.get()).negocio_nombre;
    }

    /** Limpia la caché (útil si el admin actualiza configuraciones) */
    invalidar(): void {
        this.cache = null;
    }

    /** Notifica a todos los suscriptores que pos_habilitado cambió. Llamar tras guardar la sección POS. */
    actualizarPosHabilitado(valor: boolean): void {
        this.posHabilitado$.next(valor);
    }

    /**
     * Escucha cambios en la tabla configuraciones via Supabase Realtime.
     * Solo se suscribe una vez. Si la clave pos_habilitado cambia en cualquier
     * dispositivo, todos los suscriptores de posHabilitado$ reaccionan de inmediato.
     */
    private iniciarRealtime() {
        if (this.realtimeChannel) return;

        this.realtimeChannel = this.supabase.client
            .channel('config-changes')
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'configuraciones', filter: 'clave=eq.pos_habilitado' },
                (payload) => {
                    const nuevoValor = payload.new as ConfiguracionRow;
                    const habilitado = nuevoValor.valor === 'true';
                    // Actualizar cache si existe
                    if (this.cache) {
                        this.cache = { ...this.cache, pos_habilitado: habilitado };
                    }
                    this.posHabilitado$.next(habilitado);
                }
            )
            .subscribe();
    }

    private mapRowsToConfig(rows: ConfiguracionRow[]): Configuracion {
        return mapRowsToConfig(rows);
    }
}
