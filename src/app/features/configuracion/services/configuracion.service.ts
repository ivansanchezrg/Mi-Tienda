import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { Configuracion, UpdateConfiguracionDto } from '../models/configuracion.model';

@Injectable({ providedIn: 'root' })
export class ConfiguracionService {
  private supabase = inject(SupabaseService);

  /**
   * Obtiene la configuración global del sistema (única fila).
   * Usa query directa para mostrar spinner local en la página.
   */
  async get(): Promise<Configuracion | null> {
    const { data, error } = await this.supabase.client
      .from('configuraciones')
      .select('*')
      .single();

    if (error) return null;
    return data ?? null;
  }

  /**
   * Actualiza los parámetros del negocio.
   * Usa supabase.call() para loading overlay + manejo de errores automático.
   */
  async update(id: string, dto: UpdateConfiguracionDto): Promise<Configuracion | null> {
    return this.supabase.call<Configuracion>(
      this.supabase.client
        .from('configuraciones')
        .update({ ...dto, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
    );
  }
}
