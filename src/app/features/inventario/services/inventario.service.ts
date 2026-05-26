import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { SupabaseService } from '../../../core/services/supabase.service';
import { AuthService } from '../../auth/services/auth.service';
import { Producto, ProductoPOS, ProductoPresentacion } from '../models/producto.model';
import { CategoriaProducto } from '../models/categoria-producto.model';
import { KardexInventario } from '../models/kardex.model';
import { ProductoService } from './producto.service';
import { PresentacionService } from './presentacion.service';
import { AtributoService } from './atributo.service';

export interface ProductoChangeEvent {
    tipo: 'CREADO' | 'ACTUALIZADO' | 'DESACTIVADO' | 'RECARGA';
    producto: Producto;
}

@Injectable({ providedIn: 'root' })
export class InventarioService {
    private supabase          = inject(SupabaseService);
    private auth              = inject(AuthService);
    private productoService   = inject(ProductoService);
    private presentacionSvc   = inject(PresentacionService);
    private atributoSvc       = inject(AtributoService);

    private productoChange$ = new Subject<ProductoChangeEvent>();
    readonly onProductoChange$ = this.productoChange$.asObservable();

    constructor() {
        // Conectar el bus de eventos a los servicios hijos para que sus
        // mutaciones también actualicen el grid de inventario.page.
        const emit = (e: ProductoChangeEvent) => this.productoChange$.next(e);
        this.productoService.setChangeEmitter(emit);
        this.presentacionSvc.setChangeEmitter(emit);
    }

    emitirCambio(event: ProductoChangeEvent): void {
        this.productoChange$.next(event);
    }

    // ==========================================
    // LISTADO Y BÚSQUEDA DE PRODUCTOS
    // ==========================================

    async obtenerProductos(buscar?: string, categoriaId?: string, templateId?: string, page = 0, pageSize = 25): Promise<Producto[]> {
        const from = page * pageSize;
        const to   = from + pageSize - 1;
        const data = await this.supabase.call<Producto[]>(
            this.supabase.client.rpc('fn_listar_productos', {
                p_buscar:       buscar      || null,
                p_categoria_id: categoriaId || null,
                p_template_id:  templateId  || null,
                p_from:         from,
                p_to:           to
            })
        );
        return data || [];
    }

    async obtenerProductosDesactivados(): Promise<Producto[]> {
        return this.productoService.obtenerProductosDesactivados();
    }

    async obtenerProductoPorId(id: string): Promise<Producto | null> {
        return this.productoService.obtenerPorId(id);
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

    // ==========================================
    // BÚSQUEDA POS
    // ==========================================

    async buscarProductosPOS(texto: string): Promise<ProductoPOS[]> {
        const { data } = await this.supabase.client
            .from('productos')
            .select(`
                id, nombre, codigo_barras, precio_venta, stock_actual, stock_minimo,
                imagen_url, tiene_iva, tipo_venta, unidad_medida, producto_template_id,
                producto_template:producto_templates(id, nombre),
                presentaciones:producto_presentaciones(id, producto_id, nombre, factor_conversion, precio_venta, precio_costo, codigo_barras, imagen_url, es_principal, activo)
            `)
            .eq('activo', true)
            .eq('producto_presentaciones.activo', true)
            .or(`nombre.ilike.%${texto}%,codigo_barras.ilike.%${texto}%`)
            .order('nombre')
            .limit(20);
        return (data || []) as unknown as ProductoPOS[];
    }

    async obtenerProductosCatalogoPOS(categoriaId?: string): Promise<ProductoPOS[]> {
        let query = this.supabase.client
            .from('productos')
            .select(`
                id, nombre, codigo_barras, precio_venta, stock_actual, stock_minimo,
                imagen_url, tiene_iva, tipo_venta, unidad_medida, producto_template_id,
                producto_template:producto_templates(id, nombre, imagen_url, template_atributos(atributo:atributos(nombre))),
                presentaciones:producto_presentaciones(id, producto_id, nombre, factor_conversion, precio_venta, precio_costo, codigo_barras, imagen_url, es_principal, activo)
            `)
            .eq('activo', true)
            .eq('producto_presentaciones.activo', true)
            .order('nombre');
        if (categoriaId) query = query.eq('categoria_id', categoriaId);
        const { data } = await query;
        return (data || []) as unknown as ProductoPOS[];
    }

    async buscarPorCodigoBarras(codigo: string): Promise<{ producto: ProductoPOS; presentacion?: ProductoPresentacion } | null> {
        type PresRow = {
            id: string; producto_id: string; nombre: string;
            factor_conversion: number; precio_venta: number; precio_costo: number;
            codigo_barras: string | null; imagen_url: string | null;
            es_principal: boolean; activo: boolean; producto: ProductoPOS;
        };

        const [prod, pres] = await Promise.all([
            this.supabase.call<ProductoPOS>(
                this.supabase.client
                    .from('productos')
                    .select('id, nombre, codigo_barras, precio_venta, stock_actual, stock_minimo, imagen_url, tiene_iva, tipo_venta, unidad_medida, producto_template_id')
                    .eq('codigo_barras', codigo)
                    .eq('activo', true)
                    .maybeSingle()
            ),
            this.supabase.call<PresRow>(
                this.supabase.client
                    .from('producto_presentaciones')
                    .select('id, producto_id, nombre, factor_conversion, precio_venta, precio_costo, codigo_barras, imagen_url, es_principal, activo, producto:producto_id(id, nombre, codigo_barras, precio_venta, stock_actual, stock_minimo, imagen_url, tiene_iva, tipo_venta, unidad_medida, producto_template_id)')
                    .eq('codigo_barras', codigo)
                    .eq('activo', true)
                    .maybeSingle()
            ),
        ]);

        if (prod) return { producto: prod };
        if (pres?.producto) {
            return {
                producto: pres.producto,
                presentacion: {
                    id: pres.id, producto_id: pres.producto_id, nombre: pres.nombre,
                    factor_conversion: pres.factor_conversion, precio_venta: pres.precio_venta,
                    precio_costo: pres.precio_costo, codigo_barras: pres.codigo_barras ?? undefined,
                    imagen_url: pres.imagen_url, es_principal: pres.es_principal, activo: pres.activo
                }
            };
        }
        return null;
    }

    // ==========================================
    // CATEGORÍAS
    // ==========================================

    async obtenerCategorias(): Promise<CategoriaProducto[]> {
        const res = await this.supabase.call<CategoriaProducto[]>(
            this.supabase.client.from('categorias_productos').select('*').eq('activo', true).order('nombre')
        );
        return res || [];
    }

    async crearCategoria(nombre: string): Promise<CategoriaProducto | null> {
        const res = await this.supabase.call<CategoriaProducto[]>(
            this.supabase.client
                .from('categorias_productos')
                .insert({ nombre, negocio_id: this.auth.usuarioActualValue?.negocio_id })
                .select(),
            'Categoría creada',
            { showLoading: true }
        );
        return res ? res[0] : null;
    }

    async renombrarCategoria(id: string, nombre: string): Promise<void> {
        await this.supabase.call(
            this.supabase.client.from('categorias_productos').update({ nombre }).eq('id', id),
            'Categoría renombrada',
            { showLoading: true }
        );
    }

    async contarProductosPorCategoria(categoriaId: string): Promise<{ activos: number; inactivos: number }> {
        const [activosRes, inactivosRes] = await Promise.all([
            this.supabase.client.from('productos').select('*', { count: 'exact', head: true }).eq('categoria_id', categoriaId).eq('activo', true),
            this.supabase.client.from('productos').select('*', { count: 'exact', head: true }).eq('categoria_id', categoriaId).eq('activo', false),
        ]);
        return { activos: activosRes.count || 0, inactivos: inactivosRes.count || 0 };
    }

    async desactivarCategoria(id: string): Promise<void> {
        await this.supabase.call(
            this.supabase.client.from('categorias_productos').update({ activo: false }).eq('id', id),
            'Categoría eliminada',
            { showLoading: true }
        );
    }

    // ==========================================
    // KARDEX Y STOCK
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
                p_producto_id:    productoId,
                p_tipo_movimiento: tipoMovimiento,
                p_cantidad:       cantidad,
                p_observaciones:  observaciones
            }),
            'Stock ajustado correctamente',
            { showLoading: true }
        );
        const resultado = res || { stock_nuevo: 0 };
        const productoActualizado = await this.productoService.obtenerPorId(productoId);
        if (productoActualizado) this.productoChange$.next({ tipo: 'ACTUALIZADO', producto: productoActualizado });
        return resultado;
    }

    // ==========================================
    // DELEGADOS — mantienen retrocompatibilidad
    // con los consumidores actuales mientras no
    // se migren a los servicios específicos.
    // ==========================================

    /** @deprecated Usar ProductoService.actualizar() */
    async actualizarProducto(id: string, producto: Partial<Producto>): Promise<Producto> {
        return this.productoService.actualizar(id, producto);
    }

    /** @deprecated Usar ProductoService.desactivar() */
    async desactivarProducto(id: string): Promise<void> {
        return this.productoService.desactivar(id);
    }

    /** @deprecated Usar ProductoService.reactivar() */
    async reactivarProducto(id: string): Promise<Producto> {
        return this.productoService.reactivar(id);
    }

    /** @deprecated Usar ProductoService.crearSimple() */
    async crearProductoSimple(params: Parameters<ProductoService['crearSimple']>[0]): Promise<{ ok: boolean; producto_id?: string }> {
        return this.productoService.crearSimple(params);
    }

    /** @deprecated Usar ProductoService.crearConVariantes() */
    async crearProductoConVariantes(params: Parameters<ProductoService['crearConVariantes']>[0]): Promise<{ ok: boolean; template_id?: string; skus_creados?: number }> {
        return this.productoService.crearConVariantes(params);
    }

    /** @deprecated Usar ProductoService.obtenerTemplatePorId() */
    async obtenerTemplatePorId(id: string) {
        return this.productoService.obtenerTemplatePorId(id);
    }

    /** @deprecated Usar ProductoService.obtenerSKUsDelTemplate() */
    async obtenerSKUsDelTemplate(templateId: string, excluirProductoId?: string) {
        return this.productoService.obtenerSKUsDelTemplate(templateId, excluirProductoId);
    }

    /** @deprecated Usar PresentacionService.obtenerPresentaciones() */
    async obtenerPresentaciones(productoId: string) {
        return this.presentacionSvc.obtenerPresentaciones(productoId);
    }

    /** @deprecated Usar PresentacionService.obtenerPresentacionesInactivas() */
    async obtenerPresentacionesInactivas(productoId: string) {
        return this.presentacionSvc.obtenerPresentacionesInactivas(productoId);
    }

    /** @deprecated Usar PresentacionService.crearPresentacion() */
    async crearPresentacion(presentacion: Partial<ProductoPresentacion>, silencioso = false) {
        return this.presentacionSvc.crearPresentacion(presentacion, silencioso);
    }

    /** @deprecated Usar PresentacionService.actualizarPresentacion() */
    async actualizarPresentacion(id: string, presentacion: Partial<ProductoPresentacion>) {
        return this.presentacionSvc.actualizarPresentacion(id, presentacion);
    }

    /** @deprecated Usar PresentacionService.desactivarPresentacion() */
    async desactivarPresentacion(id: string) {
        return this.presentacionSvc.desactivarPresentacion(id);
    }

    /** @deprecated Usar PresentacionService.reactivarPresentacion() */
    async reactivarPresentacion(id: string) {
        return this.presentacionSvc.reactivarPresentacion(id);
    }

    /** @deprecated Usar AtributoService */
    async buscarAtributos(texto: string) {
        return this.atributoSvc.buscarAtributos(texto);
    }

    /** @deprecated Usar AtributoService */
    async crearOObtenerAtributo(nombre: string) {
        return this.atributoSvc.crearOObtenerAtributo(nombre);
    }

    /** @deprecated Usar AtributoService */
    async buscarOpcionesAtributo(atributoId: string, texto?: string) {
        return this.atributoSvc.buscarOpcionesAtributo(atributoId, texto);
    }

    /** @deprecated Usar AtributoService */
    async obtenerOpcionesAtributo(atributoId: string) {
        return this.atributoSvc.obtenerOpcionesAtributo(atributoId);
    }

    /** @deprecated Usar AtributoService */
    async crearOObtenerOpcionAtributo(atributoId: string, valor: string) {
        return this.atributoSvc.crearOObtenerOpcionAtributo(atributoId, valor);
    }

    /** @deprecated Usar AtributoService */
    async obtenerAtributosProducto(productoId: string) {
        return this.atributoSvc.obtenerAtributosProducto(productoId);
    }

    /** @deprecated Usar AtributoService */
    async guardarAtributosProducto(productoId: string, opcionIds: string[]) {
        return this.atributoSvc.guardarAtributosProducto(productoId, opcionIds);
    }
}
