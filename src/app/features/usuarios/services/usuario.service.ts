import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { Usuario, CreateUsuarioDto, UpdateUsuarioDto } from '../models/usuario.model';

@Injectable({ providedIn: 'root' })
export class UsuarioService {
  private supabase = inject(SupabaseService);

  /**
   * Obtiene todos los usuarios ordenados por nombre.
   * Usa query directa (patrón lista) para permitir spinner inline en la página.
   */
  async getAll(): Promise<Usuario[]> {
    const { data, error } = await this.supabase.client
      .from('empleados')
      .select('*')
      .order('nombre', { ascending: true });

    if (error) return [];
    return data ?? [];
  }

  /**
   * Obtiene un usuario por ID
   */
  async getById(id: number): Promise<Usuario | null> {
    return this.supabase.call<Usuario>(
      this.supabase.client.from('empleados').select('*').eq('id', id).single()
    );
  }

  /**
   * Crea un nuevo usuario
   */
  async create(dto: CreateUsuarioDto): Promise<Usuario | null> {
    return this.supabase.call<Usuario>(
      this.supabase.client
        .from('empleados')
        .insert({ ...dto, activo: true })
        .select()
        .single()
    );
  }

  /**
   * Actualiza los datos de un usuario (rol, activo, nombre)
   */
  async update(id: number, dto: UpdateUsuarioDto): Promise<Usuario | null> {
    return this.supabase.call<Usuario>(
      this.supabase.client
        .from('empleados')
        .update(dto)
        .eq('id', id)
        .select()
        .single()
    );
  }
}
