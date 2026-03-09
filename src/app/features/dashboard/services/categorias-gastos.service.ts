import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';

/** Categoría de gasto (tabla categorias_gastos — solo admin) */
export interface CategoriaGasto {
  id: number;
  nombre: string;
  codigo: string;
  descripcion: string | null;
  activo: boolean;
  created_at: string;
}

/** DTO para crear/actualizar una categoría de gasto */
export interface CategoriaGastoInsert {
  codigo?: string;
  nombre: string;
  descripcion?: string;
  activo?: boolean;
}

@Injectable({ providedIn: 'root' })
export class CategoriasGastosService {
  private supabase = inject(SupabaseService);

  /**
   * Obtiene TODAS las categorías de gastos (activas e inactivas).
   * Sin filtro por activo — uso exclusivo del CRUD de admin.
   */
  async getCategorias(): Promise<CategoriaGasto[]> {
    const { data, error } = await this.supabase.client
      .from('categorias_gastos')
      .select('*')
      .order('codigo', { ascending: true });

    if (error) throw new Error(`Error al obtener categorías: ${error.message}`);
    return data || [];
  }

  /**
   * Crea una nueva categoría de gasto.
   */
  async crear(categoria: CategoriaGastoInsert): Promise<CategoriaGasto> {
    const { data, error } = await this.supabase.client
      .from('categorias_gastos')
      .insert({ ...categoria, activo: true })
      .select()
      .single();

    if (error) throw new Error(`Error al crear categoría: ${error.message}`);
    return data;
  }

  /**
   * Actualiza nombre, código, descripción o estado de una categoría.
   */
  async actualizar(id: number, cambios: Partial<CategoriaGastoInsert>): Promise<CategoriaGasto> {
    const { data, error } = await this.supabase.client
      .from('categorias_gastos')
      .update(cambios)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Error al actualizar categoría: ${error.message}`);
    return data;
  }
}
