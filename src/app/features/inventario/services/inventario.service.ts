import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Producto, ProductoPOS, ProductoPresentacion, GrupoVariante } from '../models/producto.model';
import { CategoriaProducto } from '../models/categoria-producto.model';
import { KardexInventario } from '../models/kardex.model';

export interface ProductoChangeEvent {
    tipo: 'CREADO' | 'ACTUALIZADO' | 'DESACTIVADO';
    producto: Producto;
}

@Injectable({
    providedIn: 'root'
})
export class InventarioService {
    private supabase = inject(SupabaseService);

    private productoChange$ = new Subject<ProductoChangeEvent>();
    readonly onProductoChange$ = this.productoChange$.asObservable();

    emitirCambio(event: ProductoChangeEvent): void {
        this.productoChange$.next(event);
    }

    // ==========================================
    // PRODUCTOS
    // ==========================================

    async obtenerProductos(buscar?: string, categoriaId?: number, page = 0, pageSize = 25): Promise<Producto[]> {
        const from = page * pageSize;
        const to = from + pageSize - 1;

        let query = this.supabase.client
            .from('productos')
            .select('*, categoria:categorias_productos(*), grupo_variante:grupos_variantes(*), presentaciones:producto_presentaciones(id)')
            .eq('activo', true)
            .eq('producto_presentaciones.activo', true)
            .order('nombre')
            .range(from, to);

        if (buscar) {
            query = query.or(`nombre.ilike.%${buscar}%,codigo_barras.ilike.%${buscar}%`);
        }

        if (categoriaId) {
            query = query.eq('categoria_id', categoriaId);
        }

        const { data } = await query;
        return data || [];
    }

    /**
     * Busqueda para POS — trae presentaciones activas en el mismo query (JOIN).
     * Permite al POS mostrar el selector de presentacion sin query extra al seleccionar.
     */
    async buscarProductosPOS(texto: string): Promise<ProductoPOS[]> {
        const { data } = await this.supabase.client
            .from('productos')
            .select(`
                id, nombre, codigo_barras, precio_venta, stock_actual, stock_minimo,
                imagen_url, tiene_iva, tipo_venta, unidad_medida, grupo_variante_id,
                presentaciones:producto_presentaciones(id, producto_id, nombre, factor_conversion, precio_venta, codigo_barras, es_principal, activo)
            `)
            .eq('activo', true)
            .eq('producto_presentaciones.activo', true)
            .or(`nombre.ilike.%${texto}%,codigo_barras.ilike.%${texto}%`)
            .order('nombre')
            .limit(10);
        return (data || []) as ProductoPOS[];
    }

    async obtenerProductoPorCodigo(codigoBarras: string): Promise<Producto | null> {
        const { data } = await this.supabase.client
            .from('productos')
            .select('*, categoria:categorias_productos(*)')
            .eq('codigo_barras', codigoBarras)
            .eq('activo', true)
            .maybeSingle();

        if (!data || !data.activo) return null;
        return data;
    }

    /**
     * Busca por codigo de barras en productos Y en presentaciones.
     * Retorna el producto base + la presentacion (si el codigo corresponde a una).
     * Usado por el POS para resolver escaneos de cajetillas, cubetas, etc.
     */
    async buscarPorCodigoBarras(codigo: string): Promise<{
        producto: ProductoPOS;
        presentacion?: ProductoPresentacion;
    } | null> {
        // 1. Buscar en productos
        const { data: prod } = await this.supabase.client
            .from('productos')
            .select('id, nombre, codigo_barras, precio_venta, stock_actual, stock_minimo, imagen_url, tiene_iva, tipo_venta, unidad_medida, grupo_variante_id')
            .eq('codigo_barras', codigo)
            .eq('activo', true)
            .maybeSingle();

        if (prod) return { producto: prod as ProductoPOS };

        // 2. Buscar en presentaciones
        const { data: pres } = await this.supabase.client
            .from('producto_presentaciones')
            .select('id, producto_id, nombre, factor_conversion, precio_venta, precio_costo, codigo_barras, es_principal, activo, producto:producto_id(id, nombre, codigo_barras, precio_venta, stock_actual, stock_minimo, imagen_url, tiene_iva, tipo_venta, unidad_medida, grupo_variante_id)')
            .eq('codigo_barras', codigo)
            .eq('activo', true)
            .maybeSingle();

        if (pres?.producto) {
            const productoData = pres.producto as any;
            return {
                producto: productoData as ProductoPOS,
                presentacion: {
                    id: pres.id,
                    producto_id: pres.producto_id,
                    nombre: pres.nombre,
                    factor_conversion: pres.factor_conversion,
                    precio_venta: pres.precio_venta,
                    precio_costo: pres.precio_costo,
                    codigo_barras: pres.codigo_barras,
                    es_principal: pres.es_principal,
                    activo: pres.activo
                }
            };
        }

        return null;
    }

    async crearProducto(producto: Partial<Producto>): Promise<Producto> {
        const res = await this.supabase.call<Producto[]>(
            this.supabase.client.from('productos').insert([producto]).select('*, categoria:categorias_productos(*)'),
            'Producto creado exitosamente',
            { showLoading: true }
        );
        const created = res ? res[0] : ({} as Producto);
        if (created.id) this.productoChange$.next({ tipo: 'CREADO', producto: created });
        return created;
    }

    async actualizarProducto(id: string, producto: Partial<Producto>): Promise<Producto> {
        const res = await this.supabase.call<Producto[]>(
            this.supabase.client.from('productos').update(producto).eq('id', id).select('*, categoria:categorias_productos(*)'),
            'Producto actualizado exitosamente',
            { showLoading: true }
        );
        const updated = res ? res[0] : ({} as Producto);
        if (updated.id) this.productoChange$.next({ tipo: 'ACTUALIZADO', producto: updated });
        return updated;
    }

    async desactivarProducto(id: string): Promise<void> {
        await this.supabase.call(
            this.supabase.client.from('productos').update({ activo: false }).eq('id', id),
            'Producto desactivado del inventario',
            { showLoading: true }
        );
        this.productoChange$.next({ tipo: 'DESACTIVADO', producto: { id } as Producto });
    }

    async reactivarProducto(id: string): Promise<Producto> {
        const res = await this.supabase.call<Producto[]>(
            this.supabase.client.from('productos').update({ activo: true }).eq('id', id).select('*, categoria:categorias_productos(*)'),
            'Producto reactivado exitosamente',
            { showLoading: true }
        );
        const updated = res ? res[0] : ({} as Producto);
        if (updated.id) this.productoChange$.next({ tipo: 'ACTUALIZADO', producto: updated });
        return updated;
    }

    async obtenerProductosDesactivados(): Promise<Producto[]> {
        const { data } = await this.supabase.client
            .from('productos')
            .select('*, categoria:categorias_productos(*)')
            .eq('activo', false)
            .order('nombre');
        return data || [];
    }

    async obtenerProductoPorId(id: string): Promise<Producto | null> {
        const { data } = await this.supabase.client
            .from('productos')
            .select('*, categoria:categorias_productos(*), grupo_variante:grupos_variantes(*), presentaciones:producto_presentaciones(id)')
            .eq('id', id)
            .eq('producto_presentaciones.activo', true)
            .maybeSingle();
        return data;
    }

    // ==========================================
    // CATEGORIAS
    // ==========================================

    async obtenerCategorias(): Promise<CategoriaProducto[]> {
        const res = await this.supabase.call<CategoriaProducto[]>(
            this.supabase.client.from('categorias_productos').select('*').eq('activo', true).order('nombre')
        );
        return res || [];
    }

    async crearCategoria(nombre: string): Promise<CategoriaProducto | null> {
        const res = await this.supabase.call<CategoriaProducto[]>(
            this.supabase.client.from('categorias_productos').insert({ nombre }).select(),
            'Categoría creada',
            { showLoading: true }
        );
        return res ? res[0] : null;
    }

    async renombrarCategoria(id: number, nombre: string): Promise<void> {
        await this.supabase.call(
            this.supabase.client.from('categorias_productos').update({ nombre }).eq('id', id),
            'Categoría renombrada',
            { showLoading: true }
        );
    }

    async contarProductosPorCategoria(categoriaId: number): Promise<{ activos: number; inactivos: number }> {
        const [activosRes, inactivosRes] = await Promise.all([
            this.supabase.client
                .from('productos')
                .select('*', { count: 'exact', head: true })
                .eq('categoria_id', categoriaId)
                .eq('activo', true),
            this.supabase.client
                .from('productos')
                .select('*', { count: 'exact', head: true })
                .eq('categoria_id', categoriaId)
                .eq('activo', false)
        ]);
        return {
            activos: activosRes.count || 0,
            inactivos: inactivosRes.count || 0
        };
    }

    async desactivarCategoria(id: number): Promise<void> {
        await this.supabase.call(
            this.supabase.client.from('categorias_productos').update({ activo: false }).eq('id', id),
            'Categoría eliminada',
            { showLoading: true }
        );
    }

    // ==========================================
    // KARDEX
    // ==========================================

    async obtenerKardexProducto(productoId: string): Promise<KardexInventario[]> {
        const res = await this.supabase.call<KardexInventario[]>(
            this.supabase.client
                .from('kardex_inventario')
                .select('*')
                .eq('producto_id', productoId)
                .order('fecha', { ascending: false })
        );
        return res || [];
    }

    async obtenerProductosStockBajo(): Promise<{ id: string; nombre: string; stock_actual: number }[]> {
        const { data } = await this.supabase.client
            .from('productos')
            .select('id, nombre, stock_actual, stock_minimo')
            .eq('activo', true)
            .order('stock_actual');
        return (data || []).filter(p => p.stock_actual <= p.stock_minimo);
    }

    async ajustarStock(productoId: string, tipoMovimiento: string, cantidad: number, observaciones: string): Promise<{ stock_nuevo: number }> {
        const res = await this.supabase.call<{ stock_nuevo: number }>(
            this.supabase.client.rpc('fn_ajustar_stock_inventario', {
                p_producto_id: productoId,
                p_tipo_movimiento: tipoMovimiento,
                p_cantidad: cantidad,
                p_observaciones: observaciones
            }),
            'Stock ajustado correctamente',
            { showLoading: true }
        );
        const resultado = res || { stock_nuevo: 0 };

        // Refrescar el producto en el grid de inventario
        const productoActualizado = await this.obtenerProductoPorId(productoId);
        if (productoActualizado) {
            this.productoChange$.next({ tipo: 'ACTUALIZADO', producto: productoActualizado });
        }

        return resultado;
    }

    // ==========================================
    // PRESENTACIONES
    // ==========================================

    async obtenerPresentaciones(productoId: string): Promise<ProductoPresentacion[]> {
        const { data } = await this.supabase.client
            .from('producto_presentaciones')
            .select('*')
            .eq('producto_id', productoId)
            .eq('activo', true)
            .order('factor_conversion');
        return data || [];
    }

    async crearPresentacion(presentacion: Partial<ProductoPresentacion>, silencioso = false): Promise<ProductoPresentacion> {
        const res = await this.supabase.call<ProductoPresentacion[]>(
            this.supabase.client.from('producto_presentaciones').insert([presentacion]).select(),
            silencioso ? undefined : 'Presentación creada',
            silencioso ? undefined : { showLoading: true }
        );
        const creada = res ? res[0] : ({} as ProductoPresentacion);
        if (creada?.producto_id) await this.emitirCambioPorPresentacion(creada.producto_id);
        return creada;
    }

    async actualizarPresentacion(id: string, presentacion: Partial<ProductoPresentacion>): Promise<void> {
        const res = await this.supabase.call<ProductoPresentacion[]>(
            this.supabase.client.from('producto_presentaciones').update(presentacion).eq('id', id).select(),
            'Presentación actualizada',
            { showLoading: true }
        );
        const productoId = res?.[0]?.producto_id;
        if (productoId) await this.emitirCambioPorPresentacion(productoId);
    }

    async desactivarPresentacion(id: string): Promise<void> {
        const res = await this.supabase.call<ProductoPresentacion[]>(
            this.supabase.client.from('producto_presentaciones').update({ activo: false }).eq('id', id).select(),
            'Presentación quitada',
            { showLoading: true }
        );
        const productoId = res?.[0]?.producto_id;
        if (productoId) await this.emitirCambioPorPresentacion(productoId);
    }

    async obtenerPresentacionesInactivas(productoId: string): Promise<ProductoPresentacion[]> {
        const { data } = await this.supabase.client
            .from('producto_presentaciones')
            .select('*')
            .eq('producto_id', productoId)
            .eq('activo', false)
            .order('factor_conversion');
        return data || [];
    }

    async reactivarPresentacion(id: string): Promise<void> {
        const res = await this.supabase.call<ProductoPresentacion[]>(
            this.supabase.client.from('producto_presentaciones').update({ activo: true }).eq('id', id).select(),
            'Presentación reactivada',
            { showLoading: true }
        );
        const productoId = res?.[0]?.producto_id;
        if (productoId) await this.emitirCambioPorPresentacion(productoId);
    }

    private async emitirCambioPorPresentacion(productoId: string): Promise<void> {
        const producto = await this.obtenerProductoPorId(productoId);
        if (producto) this.productoChange$.next({ tipo: 'ACTUALIZADO', producto });
    }

    // ==========================================
    // GRUPOS DE VARIANTES
    // ==========================================

    async obtenerGruposVariantes(): Promise<GrupoVariante[]> {
        const { data } = await this.supabase.client
            .from('grupos_variantes')
            .select('*')
            .order('nombre');
        return data || [];
    }

    async buscarGruposVariantes(texto: string): Promise<GrupoVariante[]> {
        const data = await this.supabase.call<GrupoVariante[]>(
            this.supabase.client
                .from('grupos_variantes')
                .select('*')
                .ilike('nombre', `%${texto}%`)
                .order('nombre')
                .limit(5)
        );
        return data || [];
    }

    /**
     * Crea el grupo si no existe, o devuelve el existente si ya habia uno con ese nombre.
     * Patron: INSERT ON CONFLICT DO NOTHING + SELECT.
     */
    async crearOObtenerGrupoVariante(nombre: string): Promise<GrupoVariante | null> {
        const nombreNorm = nombre.toUpperCase().trim();

        await this.supabase.client
            .from('grupos_variantes')
            .upsert({ nombre: nombreNorm }, { onConflict: 'nombre', ignoreDuplicates: true });

        const { data } = await this.supabase.client
            .from('grupos_variantes')
            .select('*')
            .eq('nombre', nombreNorm)
            .single();

        return data;
    }

    async renombrarGrupoVariante(id: string, nombre: string): Promise<void> {
        await this.supabase.call(
            this.supabase.client.from('grupos_variantes').update({ nombre: nombre.toUpperCase().trim() }).eq('id', id),
            'Grupo renombrado'
        );
    }

    async eliminarGrupoVariante(id: string): Promise<void> {
        await this.supabase.call(
            this.supabase.client.from('grupos_variantes').delete().eq('id', id),
            'Grupo eliminado'
        );
    }

    async obtenerVariantesDelGrupo(grupoId: string, excluirProductoId?: string): Promise<Producto[]> {
        let query = this.supabase.client
            .from('productos')
            .select('id, nombre, stock_actual, precio_venta, codigo_barras, imagen_url')
            .eq('grupo_variante_id', grupoId)
            .eq('activo', true)
            .order('nombre');
        if (excluirProductoId) query = query.neq('id', excluirProductoId);
        const { data } = await query;
        return (data || []) as Producto[];
    }

    async contarProductosPorGrupo(grupoId: string): Promise<number> {
        const { count } = await this.supabase.client
            .from('productos')
            .select('*', { count: 'exact', head: true })
            .eq('grupo_variante_id', grupoId)
            .eq('activo', true);
        return count || 0;
    }
}
