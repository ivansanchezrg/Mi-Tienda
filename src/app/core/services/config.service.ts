import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Configuracion, ConfiguracionRow } from '../../features/configuracion/models/configuracion.model';

const DEFAULTS: Configuracion = {
    negocio_nombre: 'Mi Tienda',
    caja_fondo_fijo_diario: 20,
    caja_varios_transferencia_dia: 20,
    bus_alerta_saldo_bajo: 75,
    bus_dias_antes_facturacion: 3,
    pos_descuentos_habilitados: false,
    pos_descuento_maximo_pct: 10,
    pos_umbral_monto_descuento: 50,
};

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
                    this.cache = this.mapRowsToConfig(rows ?? []);
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
        return (await this.get()).negocio_nombre;
    }

    /** Limpia la caché (útil si el admin actualiza configuraciones) */
    invalidar(): void {
        this.cache = null;
    }

    /** Convierte filas clave/valor a objeto tipado con defaults para claves ausentes */
    private mapRowsToConfig(rows: ConfiguracionRow[]): Configuracion {
        const map = new Map(rows.map(r => [r.clave, r.valor]));

        return {
            negocio_nombre:                map.get('negocio_nombre')                ?? DEFAULTS.negocio_nombre,
            caja_fondo_fijo_diario:        Number(map.get('caja_fondo_fijo_diario'))        || DEFAULTS.caja_fondo_fijo_diario,
            caja_varios_transferencia_dia: Number(map.get('caja_varios_transferencia_dia')) || DEFAULTS.caja_varios_transferencia_dia,
            bus_alerta_saldo_bajo:         Number(map.get('bus_alerta_saldo_bajo'))         || DEFAULTS.bus_alerta_saldo_bajo,
            bus_dias_antes_facturacion:    Number(map.get('bus_dias_antes_facturacion'))    || DEFAULTS.bus_dias_antes_facturacion,
            pos_descuentos_habilitados:    map.get('pos_descuentos_habilitados') === 'true',
            pos_descuento_maximo_pct:      Number(map.get('pos_descuento_maximo_pct'))      || DEFAULTS.pos_descuento_maximo_pct,
            pos_umbral_monto_descuento:    Number(map.get('pos_umbral_monto_descuento'))    || DEFAULTS.pos_umbral_monto_descuento,
        };
    }
}
