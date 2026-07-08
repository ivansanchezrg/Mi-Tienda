import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { NetworkService } from '../../../core/services/network.service';
import { AuthService } from '../../auth/services/auth.service';
import { ClientesLocalService } from '../../../core/services/clientes-local.service';
import { OutboxClientesService, OutboxClientePayload } from '../../../core/services/outbox-clientes.service';
import { Cliente } from '../models/cliente.model';
import { PAGINATION_CONFIG } from '../../../core/config/pagination.config';

export interface DatosNuevoCliente {
    nombre: string;
    identificacion?: string;
    telefono?: string;
    email?: string;
}

@Injectable({ providedIn: 'root' })
export class ClientesService {
    private supabase = inject(SupabaseService);
    private network = inject(NetworkService);
    private auth = inject(AuthService);
    private clientesLocal = inject(ClientesLocalService);
    private outboxClientes = inject(OutboxClientesService);

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
        // Offline: filtrar en memoria sobre la réplica cacheada (Fase A, PLAN-OFFLINE-CALLE §4.3).
        if (!this.network.isConnected()) {
            return this.clientesLocal.buscarPorTexto(texto);
        }
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
        // Offline: lookup en la réplica cacheada.
        if (!this.network.isConnected()) {
            return this.clientesLocal.buscarPorIdentificacion(identificacion);
        }
        return this.supabase.call<Cliente>(
            this.supabase.client.from('clientes')
                .select('*')
                .eq('identificacion', identificacion)
                .eq('es_consumidor_final', false)
                .maybeSingle()
        );
    }

    /**
     * Fetch liviano y completo (sin paginar) para refrescar la réplica offline
     * (Fase P/A, PLAN-OFFLINE-CALLE). Cap de 5000 — ver ClientesLocalService.CAP_CLIENTES.
     * Solo se llama online (priming); nunca se invoca sin red.
     */
    async descargarSnapshotParaCache(): Promise<Cliente[]> {
        return (await this.supabase.call<Cliente[]>(
            this.supabase.client.from('clientes')
                .select('id, identificacion, nombre, telefono, email, es_consumidor_final')
                .eq('es_consumidor_final', false)
                .order('nombre')
                .limit(ClientesService.CAP_SNAPSHOT)
        )) ?? [];
    }

    private static readonly CAP_SNAPSHOT = 5000;

    async obtenerClientePorId(id: string): Promise<Cliente | null> {
        return this.supabase.call<Cliente>(
            this.supabase.client.from('clientes')
                .select('*')
                .eq('id', id)
                .maybeSingle()
        );
    }

    /**
     * Crea un cliente. Camino único online+offline vía fn_upsert_cliente (Fase D,
     * PLAN-OFFLINE-CALLE §6.5): mismo upsert por (negocio_id, identificacion) en
     * ambos casos, protege también el double-submit online.
     *
     * Sin red: encola en outbox_clientes y devuelve el cliente con su UUID local de
     * inmediato — el vendedor sigue el flujo sin esperar al servidor. El comprobante
     * offline lleva su nombre (ticket/nota); NO habilita FACTURA ni FIADO (§6.5.1).
     */
    async crearCliente(data: DatosNuevoCliente): Promise<Cliente | null> {
        if (!this.network.isConnected()) {
            return this.crearClienteOffline(data);
        }

        const id = crypto.randomUUID();
        const respuesta = await this.supabase.call<{ success: boolean; cliente_id: string }>(
            this.supabase.client.rpc('fn_upsert_cliente', {
                p_id:             id,
                p_nombre:         data.nombre,
                p_identificacion: data.identificacion || null,
                p_telefono:       data.telefono || null,
                p_email:          data.email || null,
            }),
            'Cliente creado correctamente'
        );
        if (!respuesta?.success) return null;

        return this.obtenerClientePorId(respuesta.cliente_id);
    }

    /**
     * Encola el cliente en outbox_clientes (PENDING) y lo agrega al cache local para
     * que aparezca de inmediato en el selector. El SyncService lo drena ANTES que las
     * ventas encoladas al volver la red (§6.5.3) vía fn_upsert_cliente.
     */
    private async crearClienteOffline(data: DatosNuevoCliente): Promise<Cliente | null> {
        const id = crypto.randomUUID();
        const payload: OutboxClientePayload = {
            nombre: data.nombre,
            identificacion: data.identificacion || null,
            telefono: data.telefono || null,
            email: data.email || null,
        };

        const encolado = await this.outboxClientes.encolar(id, payload);
        if (!encolado) return null;

        const cliente: Cliente = {
            id,
            nombre: payload.nombre,
            identificacion: payload.identificacion,
            telefono: payload.telefono,
            email: payload.email,
            es_consumidor_final: false,
        };
        await this.clientesLocal.agregarUno(cliente);
        return cliente;
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
