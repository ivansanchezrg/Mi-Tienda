import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Cliente } from '../models/cliente.model';

@Injectable({ providedIn: 'root' })
export class ClientesService {
    private supabase = inject(SupabaseService);

    async obtenerConsumidorFinal(): Promise<Cliente | null> {
        return this.supabase.call<Cliente>(
            this.supabase.client.from('clientes')
                .select('*')
                .eq('es_consumidor_final', true)
                .single()
        );
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

    async crearCliente(data: { nombre: string; identificacion?: string; telefono?: string }): Promise<Cliente | null> {
        return this.supabase.call<Cliente>(
            this.supabase.client.from('clientes')
                .insert(data)
                .select()
                .single(),
            'Cliente creado correctamente'
        );
    }
}
