import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { SupabaseService } from '../../../core/services/supabase.service';
import { NetworkService } from '../../../core/services/network.service';
import { CatalogoLocalService } from '../../../core/services/catalogo-local.service';
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

/** Métricas de cabecera del inventario (fn_metricas_inventario). */
export interface MetricasInventario {
    total_activos: number;
    por_reponer: number;
    agotados: number;
    valor_inventario: number;
}

@Injectable({ providedIn: 'root' })
export class InventarioService {
    private supabase          = inject(SupabaseService);
    private auth              = inject(AuthService);
    private network           = inject(NetworkService);
    private catalogoLocal     = inject(CatalogoLocalService);
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

    async obtenerProductos(buscar?: string, categoriaId?: string, templateId?: string, page = 0, pageSize = 25, soloStockBajo = false): Promise<Producto[]> {
        const from = page * pageSize;
        const to   = from + pageSize - 1;
        const data = await this.supabase.call<Producto[]>(
            this.supabase.client.rpc('fn_listar_productos', {
                p_buscar:          buscar      || null,
                p_categoria_id:    categoriaId || null,
                p_template_id:     templateId  || null,
                p_from:            from,
                p_to:              to,
                p_solo_stock_bajo: soloStockBajo
            })
        );
        return data || [];
    }

    async obtenerProductosDesactivados(): Promise<Producto[]> {
        return this.productoService.obtenerProductosDesactivados();
    }

    /** Métricas de cabecera (total, por reponer, agotados, valor). Server-side sobre todo el catálogo. */
    async obtenerMetricas(): Promise<MetricasInventario | null> {
        return this.supabase.call<MetricasInventario>(
            this.supabase.client.rpc('fn_metricas_inventario')
        );
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
    // CATÁLOGO Y BÚSQUEDA POS
    // ==========================================

    async obtenerProductosCatalogoPOS(categoriaId?: string, categoriasParaCache?: CategoriaProducto[]): Promise<ProductoPOS[]> {
        // Offline: servir del cache filtrando por categoría en memoria.
        if (!this.network.isConnected()) {
            return this.catalogoLocal.obtenerCatalogoPorCategoria(categoriaId);
        }
        const data = await this.supabase.call<ProductoPOS[]>(
            this.supabase.client.rpc('fn_catalogo_productos_pos', {
                p_categoria_id: categoriaId ?? null
            })
        );
        const catalogo = data ?? [];
        // Solo el catálogo completo (sin filtro) refresca el snapshot — un filtro parcial
        // no debe sobrescribir el cache completo del negocio.
        if (!categoriaId && catalogo.length > 0) {
            this.guardarCacheEnBackground(catalogo, categoriasParaCache);
        }
        return catalogo;
    }

    /**
     * Guarda catálogo + categorías en background. Best-effort: nunca bloquea el flujo online.
     * Reutiliza las categorías ya cargadas por el caller si las pasa, evitando una query extra.
     */
    private guardarCacheEnBackground(catalogo: ProductoPOS[], categorias?: CategoriaProducto[]): void {
        const guardar = (cats: CategoriaProducto[]) => this.catalogoLocal.guardar(catalogo, cats);
        if (categorias) {
            guardar(categorias).catch(() => { /* cache es best-effort */ });
        } else {
            this.obtenerCategorias()
                .then(guardar)
                .catch(() => { /* cache es best-effort */ });
        }
    }

    async buscarPorCodigoBarras(codigo: string): Promise<{ producto: ProductoPOS; presentacion?: ProductoPresentacion } | null> {
        // Offline: lookup dual en memoria sobre el catálogo cacheado.
        if (!this.network.isConnected()) {
            return this.catalogoLocal.buscarPorCodigoBarras(codigo);
        }

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
        // Offline: servir las categorías cacheadas (solo lectura, mismo contrato).
        if (!this.network.isConnected()) {
            return this.catalogoLocal.obtenerCategorias();
        }
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

    async obtenerStockActual(productoId: string): Promise<number | null> {
        const { data } = await this.supabase.client
            .from('productos')
            .select('stock_actual')
            .eq('id', productoId)
            .single();
        return data?.stock_actual ?? null;
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
    // DELEGADOS — en uso real por consumidores actuales
    // ==========================================

    async desactivarProducto(id: string): Promise<void> {
        return this.productoService.desactivar(id);
    }

    async reactivarProducto(id: string): Promise<Producto> {
        return this.productoService.reactivar(id);
    }

    async obtenerAtributosProducto(productoId: string) {
        return this.atributoSvc.obtenerAtributosProducto(productoId);
    }
}
