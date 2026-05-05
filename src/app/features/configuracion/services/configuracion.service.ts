import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { Configuracion, ConfiguracionKey, ConfiguracionRow, mapRowsToConfig } from '../models/configuracion.model';

@Injectable({ providedIn: 'root' })
export class ConfiguracionService {
    private supabase = inject(SupabaseService);

    /**
     * Obtiene la configuración global como objeto tipado.
     * Usa query directa (sin caché) para mostrar spinner local en la página de admin.
     */
    async get(): Promise<Configuracion | null> {
        const rows = await this.supabase.call<ConfiguracionRow[]>(
            this.supabase.client.from('configuraciones').select('clave, valor')
        );
        if (!rows) return null;
        return this.mapRowsToConfig(rows);
    }

    /**
     * Actualiza una o varias claves de configuración.
     * Usa UPSERT para crear la fila si no existe.
     */
    async update(cambios: Partial<Configuracion>, successMessage = 'Parámetros guardados'): Promise<boolean> {
        const { data: { user } } = await this.supabase.client.auth.getUser();
        const negocioId: string = user?.app_metadata?.['negocio_id'];
        if (!negocioId) return false;

        const rows = Object.entries(cambios).map(([clave, valor]) => ({
            negocio_id: negocioId,
            clave,
            valor: String(valor),
        }));

        const result = await this.supabase.call<ConfiguracionRow[]>(
            this.supabase.client
                .from('configuraciones')
                .upsert(rows, { onConflict: 'negocio_id,clave' })
                .select('clave, valor'),
            successMessage,
            { showLoading: true }
        );

        return result !== null;
    }

    private mapRowsToConfig(rows: ConfiguracionRow[]): Configuracion {
        return mapRowsToConfig(rows);
    }
}
