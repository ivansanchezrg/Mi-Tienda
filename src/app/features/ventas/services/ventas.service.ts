import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Venta, VentaDetalle, VentasResumen } from '../models/venta.model';
import { PAGINATION_CONFIG } from '../../../core/config/pagination.config';

@Injectable({
    providedIn: 'root'
})
export class VentasService {
    private supabase = inject(SupabaseService);

    // ──────────────────────────────────────────────
    // LISTADO (con filtro de fecha)
    // ──────────────────────────────────────────────

    /**
     * Devuelve las ventas según el filtro aplicado, paginadas.
     * Delega toda la lógica de filtros, fechas (Ecuador) y búsqueda a fn_listar_ventas.
     *
     * @param filtro    'hoy' | 'semana' | 'mes' | 'todo' | 'YYYY-MM-DD'
     * @param page      Página 0-based (infinite scroll)
     * @param busqueda  Término libre: nombre, cédula o número de comprobante
     */
    async obtenerVentas(filtro: string = 'hoy', page: number = 0, busqueda?: string): Promise<Venta[]> {
        const raw = await this.supabase.call<any[]>(
            this.supabase.client.rpc('fn_listar_ventas', {
                p_filtro:    filtro,
                p_busqueda:  busqueda ?? null,
                p_page:      page,
                p_page_size: PAGINATION_CONFIG.ventas.pageSize,
            })
        ) ?? [];
        return raw.map(v => this.mapVenta(v));
    }

    /**
     * Devuelve el total de registros y el monto acumulado para el filtro activo.
     * Sin paginación — siempre refleja el universo completo de resultados.
     */
    async resumirVentas(filtro: string = 'hoy', busqueda?: string): Promise<VentasResumen> {
        const raw = await this.supabase.call<VentasResumen[]>(
            this.supabase.client.rpc('fn_resumir_ventas', {
                p_filtro:   filtro,
                p_busqueda: busqueda ?? null,
            })
        ) ?? [];
        return raw[0] ?? { total_registros: 0, total_monto: 0 };
    }


    // ──────────────────────────────────────────────
    // DETALLE (con ítems + nombre de producto)
    // ──────────────────────────────────────────────

    /**
     * Carga una venta completa con sus detalles y nombres de producto.
     */
    async obtenerVentaDetalle(ventaId: string): Promise<Venta | null> {
        const raw = await this.supabase.call<any>(
            this.supabase.client
                .from('ventas')
                .select(`
                    id,
                    turno_id,
                    empleado_id,
                    cliente_id,
                    tipo_comprobante,
                    numero_comprobante,
                    subtotal,
                    total,
                    base_iva_0,
                    base_iva_15,
                    iva_valor,
                    metodo_pago,
                    estado,
                    fecha,
                    clientes ( nombre, identificacion ),
                    empleados:empleado_id ( nombre ),
                    ventas_detalles (
                        id,
                        venta_id,
                        producto_id,
                        cantidad,
                        precio_unitario,
                        subtotal,
                        productos ( nombre )
                    )
                `)
                .eq('id', ventaId)
                .single()
        );

        if (!raw) return null;

        // Aplanar JOINs anidados a campos planos para facilitar el template
        return this.mapVentaDetalle(raw);
    }

    // ──────────────────────────────────────────────
    // HELPERS
    // ──────────────────────────────────────────────

    /**
     * fn_listar_ventas ya devuelve campos planos (cliente_nombre, empleado_nombre…).
     * mapVenta solo tipifica el objeto raw al modelo Venta.
     * mapVentaDetalle sigue usando JOINs anidados (query directa a ventas).
     */
    mapVenta(raw: any): Venta {
        return raw as Venta;
    }

    mapVentaDetalle(raw: any): Venta {
        const detalles: VentaDetalle[] = (raw.ventas_detalles ?? []).map((d: any) => ({
            id: d.id,
            venta_id: d.venta_id,
            producto_id: d.producto_id,
            cantidad: d.cantidad,
            precio_unitario: d.precio_unitario,
            subtotal: d.subtotal,
            producto_nombre: d.productos?.nombre ?? '—',
        }));

        return {
            ...raw,
            cliente_nombre: raw.clientes?.nombre ?? null,
            cliente_identificacion: raw.clientes?.identificacion ?? null,
            empleado_nombre: raw.empleados?.nombre ?? null,
            ventas_detalles: detalles,
        };
    }
}
