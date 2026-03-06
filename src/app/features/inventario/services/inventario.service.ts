import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Producto } from '../models/producto.model';
import { CategoriaProducto } from '../models/categoria-producto.model';
import { KardexInventario } from '../models/kardex.model';

@Injectable({
    providedIn: 'root'
})
export class InventarioService {
    private supabase = inject(SupabaseService);

    // ==========================================
    // PRODUCTOS
    // ==========================================

    async obtenerProductos(buscar?: string, categoriaId?: number): Promise<Producto[]> {
        let query = this.supabase.client
            .from('productos')
            .select('*, categoria:categorias_productos(*)')
            .order('nombre');

        if (buscar) {
            query = query.ilike('nombre', `%${buscar}%`);
        }

        if (categoriaId) {
            query = query.eq('categoria_id', categoriaId);
        }

        const { data } = await query;
        return data || [];
    }

    async obtenerProductoPorCodigo(codigoBarras: string): Promise<Producto | null> {
        const { data } = await this.supabase.client
            .from('productos')
            .select('*, categoria:categorias_productos(*)')
            .eq('codigo_barras', codigoBarras)
            .maybeSingle(); // mejor que single para no reventar si no hay

        return data;
    }

    async crearProducto(producto: Partial<Producto>): Promise<Producto> {
        const res = await this.supabase.call<Producto[]>(
            this.supabase.client.from('productos').insert([producto]).select(),
            'Producto creado exitosamente',
            { showLoading: true }
        );
        return res ? res[0] : ({} as Producto);
    }

    async actualizarProducto(id: string, producto: Partial<Producto>): Promise<Producto> {
        const res = await this.supabase.call<Producto[]>(
            this.supabase.client.from('productos').update(producto).eq('id', id).select(),
            'Producto actualizado exitosamente',
            { showLoading: true }
        );
        return res ? res[0] : ({} as Producto);
    }

    // ==========================================
    // CATEGORÍAS
    // ==========================================

    async obtenerCategorias(): Promise<CategoriaProducto[]> {
        const res = await this.supabase.call<CategoriaProducto[]>(
            this.supabase.client.from('categorias_productos').select('*').order('nombre')
        );
        return res || [];
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
}
