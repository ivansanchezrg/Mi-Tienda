import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

interface Configuraciones {
    nombre_negocio: string;
    fondo_fijo_diario: number;
    varios_transferencia_diaria: number;
    bus_alerta_saldo_bajo: number;
    bus_dias_antes_facturacion: number;
}

const DEFAULTS: Configuraciones = {
    nombre_negocio: 'Mi Tienda',
    fondo_fijo_diario: 20,
    varios_transferencia_diaria: 20,
    bus_alerta_saldo_bajo: 75,
    bus_dias_antes_facturacion: 3,
};

@Injectable({ providedIn: 'root' })
export class ConfigService {

    private supabase = inject(SupabaseService);

    private cache: Configuraciones | null = null;
    private loadingPromise: Promise<Configuraciones> | null = null;

    /** Carga una sola vez por sesión y cachea en memoria. */
    async get(): Promise<Configuraciones> {
        if (this.cache) return this.cache;

        // Evita múltiples queries simultáneas si se llama desde varios sitios a la vez
        if (!this.loadingPromise) {
            this.loadingPromise = this.supabase
                .call<Configuraciones[]>(
                    this.supabase.client.from('configuraciones').select('*').limit(1)
                )
                .then(data => {
                    this.cache = data?.[0] ?? DEFAULTS;
                    this.loadingPromise = null;
                    return this.cache;
                })
                .catch(() => {
                    this.loadingPromise = null;
                    return DEFAULTS;
                });
        }

        return this.loadingPromise;
    }

    /** Shortcut directo para el nombre del negocio */
    async getNombreNegocio(): Promise<string> {
        return (await this.get()).nombre_negocio;
    }

    /** Limpia la caché (útil si el admin actualiza configuraciones) */
    invalidar(): void {
        this.cache = null;
    }
}
