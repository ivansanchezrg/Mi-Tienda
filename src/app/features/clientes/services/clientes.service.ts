import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AuthService } from '../../auth/services/auth.service';
import { Cliente } from '../models/cliente.model';
import { PAGINATION_CONFIG } from '../../../core/config/pagination.config';

@Injectable({ providedIn: 'root' })
export class ClientesService {
    private supabase = inject(SupabaseService);
    private auth = inject(AuthService);

    async obtenerConsumidorFinal(): Promise<Cliente | null> {
        return this.supabase.call<Cliente>(
            this.supabase.client.from('clientes')
                .select('*')
                .eq('es_consumidor_final', true)
                .limit(1)
                .maybeSingle()
        );
    }

    async listarClientes(page: number, busqueda?: string): Promise<Cliente[]> {
        const pageSize = PAGINATION_CONFIG.clientes.pageSize;
        const from = page * pageSize;
        const to = from + pageSize - 1;

        let query = this.supabase.client.from('clientes')
            .select('*')
            .eq('es_consumidor_final', false)
            .order('nombre')
            .range(from, to);

        if (busqueda) {
            query = query.or(`nombre.ilike.%${busqueda}%,identificacion.ilike.%${busqueda}%,telefono.ilike.%${busqueda}%`);
        }

        return (await this.supabase.call<Cliente[]>(query)) ?? [];
    }

    async buscarClientes(texto: string): Promise<Cliente[]> {
        return (await this.supabase.call<Cliente[]>(
            this.supabase.client.from('clientes')
                .select('*')
                .or(`nombre.ilike.%${texto}%,identificacion.ilike.%${texto}%`)
                .eq('es_consumidor_final', false)
                .order('nombre')
                .limit(20)
        )) ?? [];
    }

    async buscarPorIdentificacion(identificacion: string): Promise<Cliente | null> {
        return this.supabase.call<Cliente>(
            this.supabase.client.from('clientes')
                .select('*')
                .eq('identificacion', identificacion)
                .eq('es_consumidor_final', false)
                .maybeSingle()
        );
    }

    async obtenerClientePorId(id: string): Promise<Cliente | null> {
        return this.supabase.call<Cliente>(
            this.supabase.client.from('clientes')
                .select('*')
                .eq('id', id)
                .maybeSingle()
        );
    }

    async crearCliente(data: { nombre: string; identificacion?: string; telefono?: string; email?: string }): Promise<Cliente | null> {
        const usuario = await this.auth.getUsuarioActual();
        return this.supabase.call<Cliente>(
            this.supabase.client.from('clientes')
                .insert({ ...data, negocio_id: usuario?.negocio_id })
                .select()
                .single(),
            'Cliente creado correctamente'
        );
    }

    async actualizarCliente(id: string, data: { nombre?: string; telefono?: string; email?: string }): Promise<Cliente | null> {
        return this.supabase.call<Cliente>(
            this.supabase.client.from('clientes')
                .update(data)
                .eq('id', id)
                .select()
                .single(),
            'Cliente actualizado correctamente'
        );
    }
}
