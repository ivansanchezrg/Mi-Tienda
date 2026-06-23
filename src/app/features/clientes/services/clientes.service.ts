import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { NetworkService } from '../../../core/services/network.service';
import { AuthService } from '../../auth/services/auth.service';
import { Cliente } from '../models/cliente.model';
import { PAGINATION_CONFIG } from '../../../core/config/pagination.config';

@Injectable({ providedIn: 'root' })
export class ClientesService {
    private supabase = inject(SupabaseService);
    private network = inject(NetworkService);
    private auth = inject(AuthService);

    // Clave del cache local del consumidor final, por negocio.
    private get cfCacheKey(): string {
        return `consumidor_final_${this.auth.usuarioActualValue?.negocio_id ?? ''}`;
    }

    /**
     * Consumidor final del negocio. Es un registro fijo (1 por negocio) usado en toda
     * venta efectivo/transferencia, por lo que se cachea en localStorage para habilitar
     * el cobro offline. Online: lee de Supabase y refresca el cache. Offline: sirve el cache.
     */
    async obtenerConsumidorFinal(): Promise<Cliente | null> {
        if (!this.network.isConnected()) {
            const cached = localStorage.getItem(this.cfCacheKey);
            return cached ? (JSON.parse(cached) as Cliente) : null;
        }

        const cliente = await this.supabase.call<Cliente>(
            this.supabase.client.from('clientes')
                .select('*')
                .eq('es_consumidor_final', true)
                .limit(1)
                .maybeSingle()
        );

        if (cliente) localStorage.setItem(this.cfCacheKey, JSON.stringify(cliente));
        return cliente;
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
        return this.supabase.call<Cliente>(
            this.supabase.client.from('clientes')
                .insert({ ...data, negocio_id: this.auth.usuarioActualValue?.negocio_id })
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
