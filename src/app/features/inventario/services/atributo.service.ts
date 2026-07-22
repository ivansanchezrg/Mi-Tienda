import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AuthService } from '../../auth/services/auth.service';
import { Atributo, AtributoOpcion, ProductoAtributo } from '../models/producto.model';

@Injectable({ providedIn: 'root' })
export class AtributoService {
    private supabase = inject(SupabaseService);
    private auth    = inject(AuthService);

    async buscarAtributos(texto: string): Promise<Atributo[]> {
        const data = await this.supabase.call<Atributo[]>(
            this.supabase.client
                .from('atributos')
                .select('*')
                .ilike('nombre', `%${texto}%`)
                .order('nombre')
                .limit(5)
        );
        return data || [];
    }

    async crearOObtenerAtributo(nombre: string): Promise<Atributo | null> {
        const nombreNorm = nombre.toUpperCase().trim();
        const negocioId  = this.auth.usuarioActualValue?.negocio_id;
        await this.supabase.call(
            this.supabase.client
                .from('atributos')
                .upsert({ negocio_id: negocioId, nombre: nombreNorm }, { onConflict: 'negocio_id,nombre', ignoreDuplicates: true })
        );
        // Filtro explícito por negocio_id (defensivo): la RLS ya aísla, pero sin este eq()
        // un .single() dependería solo de la RLS para no traer filas de otros negocios.
        return this.supabase.call<Atributo>(
            this.supabase.client.from('atributos').select('*')
                .eq('negocio_id', negocioId).eq('nombre', nombreNorm).single()
        );
    }

    async buscarOpcionesAtributo(atributoId: string, texto?: string): Promise<AtributoOpcion[]> {
        let query = this.supabase.client
            .from('atributo_opciones')
            .select('*, atributo:atributos(*)')
            .eq('atributo_id', atributoId)
            .order('valor')
            .limit(10);
        if (texto) query = query.ilike('valor', `%${texto}%`);
        const data = await this.supabase.call<AtributoOpcion[]>(query);
        return data || [];
    }

    async obtenerOpcionesAtributo(atributoId: string): Promise<AtributoOpcion[]> {
        const data = await this.supabase.call<AtributoOpcion[]>(
            this.supabase.client
                .from('atributo_opciones')
                .select('*, atributo:atributos(*)')
                .eq('atributo_id', atributoId)
                .order('valor')
        );
        return data || [];
    }

    async crearOObtenerOpcionAtributo(atributoId: string, valor: string): Promise<AtributoOpcion | null> {
        const valorNorm = valor.toUpperCase().trim();
        const negocioId = this.auth.usuarioActualValue?.negocio_id;
        await this.supabase.call(
            this.supabase.client
                .from('atributo_opciones')
                .upsert(
                    { negocio_id: negocioId, atributo_id: atributoId, valor: valorNorm },
                    { onConflict: 'atributo_id,valor', ignoreDuplicates: true }
                )
        );
        // Filtro por negocio_id explícito (defensivo) además de atributo_id + valor.
        return this.supabase.call<AtributoOpcion>(
            this.supabase.client
                .from('atributo_opciones')
                .select('*, atributo:atributos(*)')
                .eq('negocio_id', negocioId)
                .eq('atributo_id', atributoId)
                .eq('valor', valorNorm)
                .single()
        );
    }

    async obtenerAtributosProducto(productoId: string): Promise<ProductoAtributo[]> {
        const data = await this.supabase.call<ProductoAtributo[]>(
            this.supabase.client
                .from('producto_atributos')
                .select('*, atributo_opcion:atributo_opciones(*, atributo:atributos(*))')
                .eq('producto_id', productoId)
        );
        return data || [];
    }

    async guardarAtributosProducto(productoId: string, opcionIds: string[]): Promise<void> {
        await this.supabase.client.from('producto_atributos').delete().eq('producto_id', productoId);
        if (opcionIds.length === 0) return;
        const rows = opcionIds.map(id => ({ producto_id: productoId, atributo_opcion_id: id }));
        await this.supabase.call(this.supabase.client.from('producto_atributos').insert(rows));
    }
}
