import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { Configuracion, ConfiguracionKey, ConfiguracionRow } from '../models/configuracion.model';

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
    async update(cambios: Partial<Configuracion>): Promise<boolean> {
        const rows: ConfiguracionRow[] = Object.entries(cambios).map(([clave, valor]) => ({
            clave: clave as ConfiguracionKey,
            valor: String(valor),
        }));

        const result = await this.supabase.call(
            this.supabase.client
                .from('configuraciones')
                .upsert(rows, { onConflict: 'clave' }),
            'Parámetros guardados',
            { showLoading: true }
        );

        return result !== null;
    }

    private mapRowsToConfig(rows: ConfiguracionRow[]): Configuracion {
        const map = new Map(rows.map(r => [r.clave, r.valor]));
        return {
            negocio_nombre:                map.get('negocio_nombre')                ?? 'Mi Tienda',
            caja_fondo_fijo_diario:        Number(map.get('caja_fondo_fijo_diario'))        || 20,
            caja_varios_transferencia_dia: Number(map.get('caja_varios_transferencia_dia')) || 20,
            bus_alerta_saldo_bajo:         Number(map.get('bus_alerta_saldo_bajo'))         || 75,
            bus_dias_antes_facturacion:    Number(map.get('bus_dias_antes_facturacion'))    || 3,
            pos_descuentos_habilitados:    map.get('pos_descuentos_habilitados') === 'true',
            pos_descuento_maximo_pct:      Number(map.get('pos_descuento_maximo_pct'))      || 10,
            pos_umbral_monto_descuento:    Number(map.get('pos_umbral_monto_descuento'))    || 50,
        };
    }
}
