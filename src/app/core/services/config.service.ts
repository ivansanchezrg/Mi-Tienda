import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Configuracion, ConfiguracionRow, CONFIGURACION_DEFAULTS, mapRowsToConfig } from '../../features/configuracion/models/configuracion.model';

@Injectable({ providedIn: 'root' })
export class ConfigService {

    private supabase = inject(SupabaseService);

    private cache: Configuracion | null = null;
    private loadingPromise: Promise<Configuracion> | null = null;

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
                    this.cache = mapRowsToConfig(rows ?? []);
                    this.loadingPromise = null;
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
}
