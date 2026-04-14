import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AuthService } from '../../auth/services/auth.service';
import { Venta, VentaDetalle, VentasResumen, ReporteVentasDia } from '../models/venta.model';
import { getFechaLocal } from '../../../core/utils/date.util';
import { PAGINATION_CONFIG } from '../../../core/config/pagination.config';

@Injectable({
    providedIn: 'root'
})
export class VentasService {
    private supabase = inject(SupabaseService);
    private authService = inject(AuthService);

    // ──────────────────────────────────────────────
    // LISTADO (con filtro de fecha)
    // ──────────────────────────────────────────────

    /**
     * Devuelve las ventas según el filtro aplicado, paginadas.
     * Todos los roles ven todas las ventas. El filtro de turno es solo para ADMIN (frontend).
     *
     * @param filtro    'hoy' | 'semana' | 'mes' | 'todo' | 'YYYY-MM-DD'
     * @param page      Página 0-based (infinite scroll)
     * @param busqueda  Término libre: nombre, cédula o número de comprobante
     */
    async obtenerVentas(filtro: string = 'hoy', page: number = 0, busqueda?: string, estado?: string, turnoId?: string): Promise<Venta[]> {
        const raw = await this.supabase.call<any[]>(
            this.supabase.client.rpc('fn_listar_ventas', {
                p_filtro:    filtro,
                p_busqueda:  busqueda ?? null,
                p_page:      page,
                p_page_size: PAGINATION_CONFIG.ventas.pageSize,
                p_estado:    estado ?? null,
                p_turno_id:  turnoId ?? null,
            })
        ) ?? [];
        return raw.map(v => this.mapVenta(v));
    }

    /**
     * Devuelve el total de registros y el monto acumulado para el filtro activo.
     * Sin paginación — siempre refleja el universo completo de resultados.
     */
    async resumirVentas(filtro: string = 'hoy', busqueda?: string, estado?: string, turnoId?: string): Promise<VentasResumen> {
        const raw = await this.supabase.call<VentasResumen[]>(
            this.supabase.client.rpc('fn_resumir_ventas', {
                p_filtro:   filtro,
                p_busqueda: busqueda ?? null,
                p_estado:   estado ?? null,
                p_turno_id: turnoId ?? null,
            })
        ) ?? [];
        return raw[0] ?? { total_registros: 0, total_monto: 0 };
    }


    // ──────────────────────────────────────────────
    // REPORTE RESUMEN POR PERÍODO
    // ──────────────────────────────────────────────

    /**
     * Obtiene el resumen agregado de ventas para el período dado.
     * Todos los roles ven todas las ventas. El filtro de turno es solo para ADMIN (frontend).
     * @param filtro 'hoy' | 'semana' | 'mes' | 'todo'
     */
    async obtenerReportePeriodo(filtro: string, turnoId?: string): Promise<ReporteVentasDia> {
        const { inicio, fin } = this.calcularRangoFiltro(filtro);

        const resultado = await this.supabase.call<ReporteVentasDia>(
            this.supabase.client.rpc('fn_reporte_ventas_periodo', {
                p_fecha_inicio: inicio,
                p_fecha_fin:    fin,
                p_turno_id:     turnoId ?? null,
            })
        );

        return resultado ?? {
            fecha_inicio: inicio,
            fecha_fin:    fin,
            total_ventas: 0,
            total_monto: 0,
            total_anuladas: 0,
            monto_anulado: 0,
            costo_total: 0,
            ganancia_bruta: 0,
            margen_pct: 0,
            por_metodo_pago: [],
            por_tipo_comprobante: [],
            top_productos: []
        };
    }

    private calcularRangoFiltro(filtro: string): { inicio: string; fin: string } {
        const hoy = getFechaLocal();
        const fecha = new Date(hoy + 'T00:00:00');

        if (filtro === 'semana') {
            const lunes = new Date(fecha);
            lunes.setDate(fecha.getDate() - fecha.getDay() + (fecha.getDay() === 0 ? -6 : 1));
            return { inicio: lunes.toISOString().split('T')[0], fin: hoy };
        }

        if (filtro === 'mes') {
            return { inicio: `${hoy.slice(0, 7)}-01`, fin: hoy };
        }

        if (filtro === 'todo') {
            return { inicio: '2000-01-01', fin: hoy };
        }

        // 'hoy' por defecto
        return { inicio: hoy, fin: hoy };
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
                    descuento,
                    descuento_pct,
                    total,
                    base_iva_0,
                    base_iva_15,
                    iva_valor,
                    metodo_pago,
                    estado,
                    estado_pago,
                    observaciones,
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
                    ),
                    cuentas_cobrar ( monto )
                `)
                .eq('id', ventaId)
                .single()
        );

        if (!raw) return null;

        // Aplanar JOINs anidados a campos planos para facilitar el template
        return this.mapVentaDetalle(raw);
    }

    // ──────────────────────────────────────────────
    // ANULACIÓN
    // ──────────────────────────────────────────────

    /**
     * Anula una venta completada revirtiendo stock, saldo de caja y cuentas por cobrar.
     * Llama a la función RPC `anular_venta` que ejecuta todo en una transacción atómica.
     */
    async anularVenta(ventaId: string, motivo: string): Promise<any> {
        const usuario = await this.authService.getUsuarioActual();
        if (!usuario) throw new Error('No se pudo obtener el usuario actual');

        return this.supabase.call(
            this.supabase.client.rpc('fn_anular_venta', {
                p_venta_id: ventaId,
                p_empleado_id: usuario.id,
                p_motivo: motivo
            }),
            'Venta anulada correctamente',
            { showLoading: true }
        );
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

        const totalAbonado = (raw.cuentas_cobrar ?? [])
            .reduce((sum: number, p: any) => sum + Number(p.monto), 0);

        return {
            ...raw,
            cliente_nombre: raw.clientes?.nombre ?? null,
            cliente_identificacion: raw.clientes?.identificacion ?? null,
            empleado_nombre: raw.empleados?.nombre ?? null,
            total_abonado: totalAbonado,
            ventas_detalles: detalles,
        };
    }
}
