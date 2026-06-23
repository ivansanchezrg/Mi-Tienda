import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { AuthService } from '../../auth/services/auth.service';
import { Configuracion, ConfiguracionKey, ConfiguracionRow, DatosNegocio, mapRowsToConfig } from '../models/configuracion.model';

@Injectable({ providedIn: 'root' })
export class ConfiguracionService {
    private supabase = inject(SupabaseService);
    private auth = inject(AuthService);

    /**
     * Obtiene la configuración operativa del negocio activo (sin datos de identidad).
     * Usa query directa (sin caché) para mostrar spinner local en la página de parámetros.
     */
    async get(): Promise<Configuracion | null> {
        const rows = await this.supabase.call<ConfiguracionRow[]>(
            this.supabase.client.from('configuraciones').select('clave, valor')
        );
        if (!rows) return null;
        return this.mapRowsToConfig(rows);
    }

    /**
     * Obtiene los datos de identidad del negocio activo desde la tabla `negocios`.
     * Fuente de verdad: negocios (no configuraciones).
     */
    async getDatosNegocio(): Promise<DatosNegocio | null> {
        const negocioId = this.auth.usuarioActualValue?.negocio_id;
        if (!negocioId) return null;

        const dato = await this.supabase.call<DatosNegocio>(
            this.supabase.client
                .from('negocios')
                .select('id, nombre, slug, telefono, direccion, correo_electronico, ruc, razon_social, nombre_comercial, codigo_establecimiento, codigo_punto_emision, ambiente_sri, obligado_contabilidad')
                .eq('id', negocioId)
                .single()
        );
        return dato;
    }

    /**
     * Actualiza los parámetros operativos del negocio (tabla configuraciones).
     * Para datos de identidad (nombre, teléfono, dirección, RUC, etc.) usar actualizarDatosNegocio().
     */
    async update(cambios: Partial<Configuracion>, successMessage = 'Parámetros guardados'): Promise<boolean> {
        const negocioId = this.auth.usuarioActualValue?.negocio_id;
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

    /**
     * Actualiza los datos de identidad del negocio (tabla negocios) via RPC.
     * SECURITY DEFINER en la función SQL bypassa el RLS de negocios.
     * Solo el ADMIN del negocio activo puede ejecutar esta operación.
     */
    async actualizarDatosNegocio(
        datos: {
            nombre?: string;
            telefono?: string;
            direccion?: string;
            correo_electronico?: string;
            ruc?: string;
            razon_social?: string;
            nombre_comercial?: string;
            codigo_establecimiento?: string;
            codigo_punto_emision?: string;
            ambiente_sri?: number;
            obligado_contabilidad?: boolean;
        },
        successMessage = 'Datos del negocio actualizados'
    ): Promise<boolean> {
        const result = await this.supabase.call(
            this.supabase.client.rpc('fn_actualizar_datos_negocio', {
                p_nombre:                 datos.nombre                 ?? null,
                p_telefono:               datos.telefono               ?? null,
                p_direccion:              datos.direccion               ?? null,
                p_correo_electronico:     datos.correo_electronico     ?? null,
                p_ruc:                    datos.ruc                    ?? null,
                p_razon_social:           datos.razon_social           ?? null,
                p_nombre_comercial:       datos.nombre_comercial       ?? null,
                p_codigo_establecimiento: datos.codigo_establecimiento ?? null,
                p_codigo_punto_emision:   datos.codigo_punto_emision   ?? null,
                p_ambiente_sri:           datos.ambiente_sri           ?? null,
                p_obligado_contabilidad:  datos.obligado_contabilidad  ?? null,
            }),
            successMessage,
            { showLoading: true }
        );
        return result !== null;
    }

    private mapRowsToConfig(rows: ConfiguracionRow[]): Configuracion {
        return mapRowsToConfig(rows);
    }
}
