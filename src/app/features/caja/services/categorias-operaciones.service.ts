import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { AuthService } from '../../auth/services/auth.service';
import { CategoriaOperacion, CategoriaOperacionInsert } from '../models/categoria-operacion.model';

@Injectable({ providedIn: 'root' })
export class CategoriasOperacionesService {
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);

  /**
   * Obtiene TODAS las categorías (incluyendo las del sistema).
   * Sin filtro por seleccionable — uso exclusivo del CRUD de admin.
   * Orden: EGRESO primero, luego INGRESO; dentro de cada tipo por código.
   */
  async getCategorias(): Promise<CategoriaOperacion[]> {
    const { data, error } = await this.supabase.client
      .from('categorias_operaciones')
      .select('*')
      .order('tipo',   { ascending: true })  // EGRESO antes que INGRESO (E < I)
      .order('codigo', { ascending: true });

    if (error) throw new Error(`Error al obtener categorías: ${error.message}`);
    return data || [];
  }

  /**
   * Crea una nueva categoría de operación manual.
   * Siempre se crea con seleccionable = true (visible en dropdowns del usuario).
   */
  async crear(categoria: CategoriaOperacionInsert): Promise<CategoriaOperacion> {
    const data = await this.supabase.call<CategoriaOperacion>(
      this.supabase.client
        .from('categorias_operaciones')
        .insert({ ...categoria, seleccionable: true, negocio_id: this.auth.usuarioActualValue?.negocio_id })
        .select()
        .single()
    );
    if (!data) throw new Error('Error al crear categoría');
    return data;
  }

  /**
   * Actualiza nombre, código, tipo o descripción de una categoría.
   */
  async actualizar(id: string, cambios: Partial<CategoriaOperacionInsert>): Promise<CategoriaOperacion> {
    const { data, error } = await this.supabase.client
      .from('categorias_operaciones')
      .update(cambios)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Error al actualizar categoría: ${error.message}`);
    return data;
  }

  /**
   * Activa o desactiva una categoría.
   * Las categorías del sistema (seleccionable = false) también pueden desactivarse.
   */
  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client
      .from('categorias_operaciones')
      .update({ activo })
      .eq('id', id);

    if (error) throw new Error(`Error al actualizar estado: ${error.message}`);
  }
}
