import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Producto, ProductoPOS, ProductoPresentacion, ProductoTemplate, Atributo, AtributoOpcion, ProductoAtributo } from '../models/producto.model';
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
            .select('*, categoria:categorias_productos(*), producto_template:producto_templates(*), presentaciones:producto_presentaciones(id)')
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
                imagen_url, tiene_iva, tipo_venta, unidad_medida, producto_template_id,
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
        const prod = await this.supabase.call<ProductoPOS>(
            this.supabase.client
                .from('productos')
                .select('id, nombre, codigo_barras, precio_venta, stock_actual, stock_minimo, imagen_url, tiene_iva, tipo_venta, unidad_medida, producto_template_id')
                .eq('codigo_barras', codigo)
                .eq('activo', true)
                .maybeSingle()
        );

        if (prod) return { producto: prod };

        // 2. Buscar en presentaciones
        const pres = await this.supabase.call<{
            id: string;
            producto_id: string;
            nombre: string;
            factor_conversion: number;
            precio_venta: number;
            precio_costo: number;
            codigo_barras: string | null;
            es_principal: boolean;
            activo: boolean;
            producto: ProductoPOS;
        }>(
            this.supabase.client
                .from('producto_presentaciones')
                .select('id, producto_id, nombre, factor_conversion, precio_venta, precio_costo, codigo_barras, es_principal, activo, producto:producto_id(id, nombre, codigo_barras, precio_venta, stock_actual, stock_minimo, imagen_url, tiene_iva, tipo_venta, unidad_medida, producto_template_id)')
                .eq('codigo_barras', codigo)
                .eq('activo', true)
                .maybeSingle()
        );

        if (pres?.producto) {
            return {
                producto: pres.producto,
                presentacion: {
                    id: pres.id,
                    producto_id: pres.producto_id,
                    nombre: pres.nombre,
                    factor_conversion: pres.factor_conversion,
                    precio_venta: pres.precio_venta,
                    precio_costo: pres.precio_costo,
                    codigo_barras: pres.codigo_barras ?? undefined,
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
            .select('*, categoria:categorias_productos(*), producto_template:producto_templates(*), presentaciones:producto_presentaciones(id)')
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

    async obtenerKardexProducto(productoId: string, limit = 100): Promise<KardexInventario[]> {
        const res = await this.supabase.call<KardexInventario[]>(
            this.supabase.client
                .from('kardex_inventario')
                .select('*, presentacion:producto_presentaciones(nombre, factor_conversion)')
                .eq('producto_id', productoId)
                .order('fecha', { ascending: false })
                .limit(limit)
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
    // TEMPLATES DE PRODUCTO (v10)
    // ==========================================

    async obtenerTemplatePorId(id: string): Promise<ProductoTemplate | null> {
        const data = await this.supabase.call<ProductoTemplate>(
            this.supabase.client
                .from('producto_templates')
                .select('*, categoria:categorias_productos(*)')
                .eq('id', id)
                .single()
        );
        return data;
    }

    async obtenerSKUsDelTemplate(templateId: string, excluirProductoId?: string): Promise<Producto[]> {
        let query = this.supabase.client
            .from('productos')
            .select('id, nombre, stock_actual, precio_venta, codigo_barras, imagen_url')
            .eq('producto_template_id', templateId)
            .eq('activo', true)
            .order('nombre');
        if (excluirProductoId) query = query.neq('id', excluirProductoId);
        const { data } = await query;
        return (data || []) as Producto[];
    }

    // ==========================================
    // ATRIBUTOS (v10)
    // ==========================================

    /** Busca atributos por nombre (autocompletado: "SABOR", "COLOR", etc.) */
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

    /** Crea el atributo si no existe, o devuelve el existente. Upsert silencioso. */
    async crearOObtenerAtributo(nombre: string): Promise<Atributo | null> {
        const nombreNorm = nombre.toUpperCase().trim();
        await this.supabase.client
            .from('atributos')
            .upsert({ nombre: nombreNorm }, { onConflict: 'nombre', ignoreDuplicates: true });
        const data = await this.supabase.call<Atributo>(
            this.supabase.client.from('atributos').select('*').eq('nombre', nombreNorm).single()
        );
        return data;
    }

    /** Busca opciones de un atributo (autocompletado de valores) */
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

    /** Obtiene TODAS las opciones de un atributo (para mostrar chips seleccionables) */
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

    /** Crea la opcion si no existe, o devuelve la existente. */
    async crearOObtenerOpcionAtributo(atributoId: string, valor: string): Promise<AtributoOpcion | null> {
        const valorNorm = valor.toUpperCase().trim();
        await this.supabase.client
            .from('atributo_opciones')
            .upsert(
                { atributo_id: atributoId, valor: valorNorm },
                { onConflict: 'atributo_id,valor', ignoreDuplicates: true }
            );
        const data = await this.supabase.call<AtributoOpcion>(
            this.supabase.client
                .from('atributo_opciones')
                .select('*, atributo:atributos(*)')
                .eq('atributo_id', atributoId)
                .eq('valor', valorNorm)
                .single()
        );
        return data;
    }

    /** Obtiene todos los atributos de un producto (para mostrar en form y tarjeta) */
    async obtenerAtributosProducto(productoId: string): Promise<ProductoAtributo[]> {
        const data = await this.supabase.call<ProductoAtributo[]>(
            this.supabase.client
                .from('producto_atributos')
                .select('*, atributo_opcion:atributo_opciones(*, atributo:atributos(*))')
                .eq('producto_id', productoId)
        );
        return data || [];
    }

    /** Reemplaza TODOS los atributos de un producto (delete + insert) */
    async guardarAtributosProducto(productoId: string, opcionIds: string[]): Promise<void> {
        // Borrar los existentes
        await this.supabase.client
            .from('producto_atributos')
            .delete()
            .eq('producto_id', productoId);
        // Insertar los nuevos (si hay)
        if (opcionIds.length === 0) return;
        const rows = opcionIds.map(id => ({ producto_id: productoId, atributo_opcion_id: id }));
        await this.supabase.call(
            this.supabase.client.from('producto_atributos').insert(rows)
        );
    }

    // ==========================================
    // CREACION ATOMICA DE PRODUCTO (RPC)
    // ==========================================

    /**
     * Crea un producto simple (sin variantes) via RPC atomica.
     * Incluye presentaciones opcionales.
     */
    async crearProductoSimple(params: {
        nombre: string;
        categoria_id: number;
        tiene_iva: boolean;
        tipo_venta: string;
        unidad_medida: string;
        codigo_barras?: string;
        imagen_url?: string;
        precio_costo: number;
        precio_venta: number;
        stock_actual: number;
        stock_minimo: number;
        presentaciones?: { nombre: string; factor_conversion: number; precio_venta: number; precio_costo: number; codigo_barras?: string }[];
    }): Promise<{ ok: boolean; producto_id?: string }> {
        const res = await this.supabase.call<{ ok: boolean; producto_id?: string }>(
            this.supabase.client.rpc('fn_crear_producto_simple', {
                p_nombre: params.nombre,
                p_categoria_id: params.categoria_id,
                p_tiene_iva: params.tiene_iva,
                p_tipo_venta: params.tipo_venta,
                p_unidad_medida: params.unidad_medida,
                p_codigo_barras: params.codigo_barras || null,
                p_imagen_url: params.imagen_url || null,
                p_precio_costo: params.precio_costo,
                p_precio_venta: params.precio_venta,
                p_stock_actual: params.stock_actual,
                p_stock_minimo: params.stock_minimo,
                p_presentaciones: params.presentaciones || []
            }),
            'Producto creado exitosamente',
            { showLoading: true }
        );
        return res || { ok: false };
    }

    /**
     * Crea un producto con variantes via RPC atomica.
     * Crea template + atributos + SKUs + presentaciones por SKU.
     */
    async crearProductoConVariantes(params: {
        nombre: string;
        categoria_id: number;
        tiene_iva: boolean;
        tipo_venta: string;
        unidad_medida: string;
        imagen_url?: string;
        atributos_template: { atributo_nombre: string; opcion_ids: string[] }[];
        variantes: { nombre: string; precio_costo: number; precio_venta: number; stock_actual: number; stock_minimo: number; opcion_ids: string[]; codigo_barras?: string | null; presentaciones?: { nombre: string; factor_conversion: number; precio_venta: number; precio_costo: number; codigo_barras?: string }[] }[];
    }): Promise<{ ok: boolean; template_id?: string; skus_creados?: number }> {
        const res = await this.supabase.call<{ ok: boolean; template_id?: string; skus_creados?: number }>(
            this.supabase.client.rpc('fn_crear_producto_con_variantes', {
                p_nombre: params.nombre,
                p_categoria_id: params.categoria_id,
                p_tiene_iva: params.tiene_iva,
                p_tipo_venta: params.tipo_venta,
                p_unidad_medida: params.unidad_medida,
                p_imagen_url: params.imagen_url || null,
                p_atributos_template: params.atributos_template,
                p_variantes: params.variantes
            }),
            `${params.variantes.length} variantes creadas`,
            { showLoading: true }
        );
        return res || { ok: false };
    }

    /**
     * Verifica si ya existe un SKU con la misma combinacion de atributos en un template.
     * Retorna true si ya existe (duplicado).
     */
    async existeCombinacionAtributos(templateId: string, opcionIds: string[], excluirProductoId?: string): Promise<boolean> {
        // Obtener todos los productos del template
        const { data: skus } = await this.supabase.client
            .from('productos')
            .select('id')
            .eq('producto_template_id', templateId)
            .eq('activo', true);

        if (!skus || skus.length === 0) return false;

        // Para cada SKU, obtener sus atributos y comparar
        for (const sku of skus) {
            if (excluirProductoId && sku.id === excluirProductoId) continue;

            const { data: attrs } = await this.supabase.client
                .from('producto_atributos')
                .select('atributo_opcion_id')
                .eq('producto_id', sku.id);

            if (!attrs) continue;

            const existingIds = attrs.map(a => a.atributo_opcion_id).sort();
            const newIds = [...opcionIds].sort();

            if (existingIds.length === newIds.length && existingIds.every((id, i) => id === newIds[i])) {
                return true; // Combinacion duplicada
            }
        }

        return false;
    }
}
