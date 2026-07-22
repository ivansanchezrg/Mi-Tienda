import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AuthService } from '../../auth/services/auth.service';
import { Producto, ProductoTemplate } from '../models/producto.model';
import { ProductoChangeEvent } from './inventario.service';

/**
 * Mensajes de éxito: NINGÚN método de este servicio pasa `successMessage` a
 * supabase.call() a propósito. Crear/editar producto o plantilla navega fuera de la
 * página apenas termina (navigateBack) — un toast ahí compite con la transición y se
 * pierde. La página muestra el overlay de éxito (FeedbackOverlayService) DESPUÉS de
 * confirmar el resultado y ANTES de navegar. El error, en cambio, SÍ lo maneja
 * call() (toast con el mensaje real) — el problema aquí no era el error, era que el
 * éxito no se veía y que un resultado fallido igual dejaba navegar (ver retornos
 * `| null` en vez de objetos vacíos). Ver design_toast_vs_overlay_feedback.md.
 */

@Injectable({ providedIn: 'root' })
export class ProductoService {
    private supabase = inject(SupabaseService);
    private auth    = inject(AuthService);

    // Mismo patrón que PresentacionService: el emitter lo conecta InventarioService
    // para que los cambios lleguen al grid de inventario.page sin dependencia circular.
    private changeEmitter?: (event: ProductoChangeEvent) => void;

    setChangeEmitter(fn: (event: ProductoChangeEvent) => void): void {
        this.changeEmitter = fn;
    }

    // ==========================================
    // LECTURA
    // ==========================================

    async obtenerPorId(id: string): Promise<Producto | null> {
        const { data } = await this.supabase.client
            .from('productos')
            .select('*, categoria:categorias_productos(*), producto_template:producto_templates(id, nombre, categoria_id, tipo_venta, unidad_medida, imagen_url, activo), presentaciones:producto_presentaciones(id)')
            .eq('id', id)
            .eq('producto_presentaciones.activo', true)
            .maybeSingle();
        return data;
    }

    async obtenerTemplatePorId(id: string): Promise<ProductoTemplate | null> {
        return this.supabase.call<ProductoTemplate>(
            this.supabase.client
                .from('producto_templates')
                .select('*, categoria:categorias_productos(*)')
                .eq('id', id)
                .single()
        );
    }

    /**
     * Actualiza los datos generales de un template (grupo de variantes): nombre,
     * categoría e imagen general. La operación es atómica vía RPC y multi-tenant
     * (la función valida pertenencia al negocio). Emite RECARGA porque el cambio
     * afecta a la tarjeta agrupada del grid (nombre/imagen) y potencialmente a la
     * categoría de todas las variantes.
     */
    async actualizarTemplate(params: {
        template_id: string;
        nombre: string;
        categoria_id: string;
        imagen_url?: string | null;
    }): Promise<{ ok: boolean; template_id?: string }> {
        // Sin showLoading: el botón del formulario ya muestra su propio spinner
        // ("Guardando...") + está disabled — un overlay global "Procesando" sería redundante.
        const res = await this.supabase.call<{ ok: boolean; template_id?: string }>(
            this.supabase.client.rpc('fn_actualizar_template', {
                p_template_id:  params.template_id,
                p_nombre:       params.nombre,
                p_categoria_id: params.categoria_id,
                p_imagen_url:   params.imagen_url || null
            })
        );
        const result = res || { ok: false };
        if (result.ok) this.changeEmitter?.({ tipo: 'RECARGA', producto: {} as Producto });
        return result;
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

    async obtenerProductosDesactivados(): Promise<Producto[]> {
        const { data } = await this.supabase.client
            .from('productos')
            .select('*, categoria:categorias_productos(*)')
            .eq('activo', false)
            .order('nombre');
        return data || [];
    }

    // ==========================================
    // MUTACIONES DIRECTAS (edición de campos)
    // ==========================================

    /** Retorna null si falló (call() ya mostró el toast de error) — la página NO debe navegar en ese caso. */
    async actualizar(id: string, producto: Partial<Producto>): Promise<Producto | null> {
        // Sin showLoading: el botón del formulario de edición ya muestra su spinner.
        const res = await this.supabase.call<Producto[]>(
            this.supabase.client
                .from('productos')
                .update(producto)
                .eq('id', id)
                .select('*, categoria:categorias_productos(*), producto_template:producto_templates(*, categoria:categorias_productos(*))')
        );
        const updated = res?.[0] ?? null;
        if (updated) this.changeEmitter?.({ tipo: 'ACTUALIZADO', producto: updated });
        return updated;
    }

    async desactivar(id: string): Promise<void> {
        await this.supabase.call(
            this.supabase.client.from('productos').update({ activo: false }).eq('id', id),
            'Producto desactivado del inventario',
            { showLoading: true }
        );
        this.changeEmitter?.({ tipo: 'DESACTIVADO', producto: { id } as Producto });
    }

    async reactivar(id: string): Promise<Producto> {
        const res = await this.supabase.call<Producto[]>(
            this.supabase.client
                .from('productos')
                .update({ activo: true })
                .eq('id', id)
                .select('*, categoria:categorias_productos(*), producto_template:producto_templates(*, categoria:categorias_productos(*))'),
            'Producto reactivado exitosamente',
            { showLoading: true }
        );
        const updated = res ? res[0] : ({} as Producto);
        if (updated.id) this.changeEmitter?.({ tipo: 'ACTUALIZADO', producto: updated });
        return updated;
    }

    /**
     * Toggle de favorito (por SKU). Sin showLoading ni toast: el ícono de estrella
     * cambiando en el momento ya es el feedback — el caller hace el toggle optimista
     * y revierte si esto retorna null (call() ya mostró el toast de error).
     */
    async toggleFavorito(id: string, favorito: boolean): Promise<Producto | null> {
        const res = await this.supabase.call<Producto[]>(
            this.supabase.client
                .from('productos')
                .update({ favorito })
                .eq('id', id)
                .select('*, categoria:categorias_productos(*), producto_template:producto_templates(*, categoria:categorias_productos(*))')
        );
        const updated = res?.[0] ?? null;
        if (updated) this.changeEmitter?.({ tipo: 'ACTUALIZADO', producto: updated });
        return updated;
    }

    /**
     * Toggle de favorito a nivel TEMPLATE (all-or-nothing): marca TODAS las variantes
     * del template como favoritas o no. El favorito vive en productos.favorito (por SKU),
     * pero un template está en favoritos como un todo — nunca variantes sueltas. Un solo
     * UPDATE con filtro por producto_template_id (una tabla → query directa). Sin toast:
     * la estrella cambiando es el feedback; el caller revierte optimista si retorna null.
     */
    async toggleFavoritoTemplate(templateId: string, favorito: boolean): Promise<boolean> {
        const res = await this.supabase.call<Producto[]>(
            this.supabase.client
                .from('productos')
                .update({ favorito })
                .eq('producto_template_id', templateId)
                .select('id')
        );
        const ok = res !== null;
        if (ok) this.changeEmitter?.({ tipo: 'RECARGA', producto: {} as Producto });
        return ok;
    }

    // ==========================================
    // CREACIÓN ATÓMICA VIA RPC
    // ==========================================

    async crearSimple(params: {
        nombre: string;
        categoria_id: string;
        tiene_iva: boolean;
        tipo_venta: string;
        unidad_medida: string;
        codigo_barras?: string;
        imagen_url?: string;
        precio_costo: number;
        precio_venta: number;
        stock_actual: number;
        stock_minimo: number;
        favorito?: boolean;
        presentaciones?: {
            nombre: string;
            factor_conversion: number;
            precio_venta: number;
            precio_costo: number;
            codigo_barras?: string;
            imagen_url?: string;
        }[];
    }): Promise<{ ok: boolean; producto_id?: string }> {
        const res = await this.supabase.call<{ ok: boolean; producto_id?: string }>(
            this.supabase.client.rpc('fn_crear_producto_simple', {
                p_nombre:         params.nombre,
                p_categoria_id:   params.categoria_id,
                p_tiene_iva:      params.tiene_iva,
                p_tipo_venta:     params.tipo_venta,
                p_unidad_medida:  params.unidad_medida,
                p_codigo_barras:  params.codigo_barras  || null,
                p_imagen_url:     params.imagen_url     || null,
                p_precio_costo:   params.precio_costo,
                p_precio_venta:   params.precio_venta,
                p_stock_actual:   params.stock_actual,
                p_stock_minimo:   params.stock_minimo,
                p_favorito:       params.favorito ?? false,
                p_presentaciones: params.presentaciones || []
            })
            // Sin showLoading: el botón "Guardar producto" ya muestra su spinner.
        );
        const result = res || { ok: false };
        if (result.ok && result.producto_id) {
            const producto = await this.obtenerPorId(result.producto_id);
            if (producto) this.changeEmitter?.({ tipo: 'CREADO', producto });
        }
        return result;
    }

    async crearConVariantes(params: {
        nombre: string;
        categoria_id: string;
        tiene_iva: boolean;
        tipo_venta: string;
        unidad_medida: string;
        favorito?: boolean;
        imagen_url?: string;
        atributos_template: { atributo_nombre: string; opcion_ids: string[] }[];
        variantes: {
            nombre: string;
            precio_costo: number;
            precio_venta: number;
            stock_actual: number;
            stock_minimo: number;
            opcion_ids: string[];
            codigo_barras?: string | null;
            imagen_url?: string | null;
            presentaciones?: {
                nombre: string;
                factor_conversion: number;
                precio_venta: number;
                precio_costo: number;
                codigo_barras?: string;
                imagen_url?: string;
            }[];
        }[];
    }): Promise<{ ok: boolean; template_id?: string; skus_creados?: number }> {
        const res = await this.supabase.call<{ ok: boolean; template_id?: string; skus_creados?: number }>(
            this.supabase.client.rpc('fn_crear_producto_con_variantes', {
                p_nombre:             params.nombre,
                p_categoria_id:       params.categoria_id,
                p_tiene_iva:          params.tiene_iva,
                p_tipo_venta:         params.tipo_venta,
                p_unidad_medida:      params.unidad_medida,
                p_favorito:           params.favorito ?? false,
                p_imagen_url:         params.imagen_url || null,
                p_atributos_template: params.atributos_template,
                p_variantes:          params.variantes
            })
            // Sin showLoading: el botón "Guardar producto" ya muestra su spinner.
        );
        const result = res || { ok: false };
        if (result.ok) this.changeEmitter?.({ tipo: 'RECARGA', producto: {} as Producto });
        return result;
    }
}
