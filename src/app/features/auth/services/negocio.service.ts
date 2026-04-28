import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { NegocioDisponible } from './auth.service';

@Injectable({ providedIn: 'root' })
export class NegocioService {
  private supabase = inject(SupabaseService);

  /**
   * Crea una sucursal nueva para el usuario actual.
   * Llama a fn_crear_negocio con el email del JWT como admin.
   * Retorna el negocio_id creado o null en caso de error.
   */
  async crearSucursal(nombre: string): Promise<{ negocio_id: string; negocio_nombre: string } | null> {
    const { data: { user } } = await this.supabase.client.auth.getUser();
    if (!user?.email) return null;

    const { data, error } = await this.supabase.client.rpc('fn_crear_negocio', {
      p_nombre_negocio: nombre.trim(),
      p_admin_email:    user.email,
      p_admin_nombre:   user.user_metadata?.['full_name'] ?? user.email.split('@')[0]
    });

    if (error || !data?.negocio_id) return null;

    return {
      negocio_id:     data.negocio_id,
      negocio_nombre: nombre.trim()
    };
  }

  /**
   * Obtiene todas las membresías activas del usuario actual.
   * Usado por el selector de negocios en el sidebar.
   */
  async getMisNegocios(): Promise<NegocioDisponible[]> {
    const { data: { user } } = await this.supabase.client.auth.getUser();
    if (!user?.email) return [];

    const { data: usuario } = await this.supabase.client
      .from('usuarios')
      .select('id')
      .eq('email', user.email)
      .maybeSingle();

    if (!usuario) return [];

    const { data: membresias } = await this.supabase.client
      .from('usuario_negocios')
      .select('negocio_id, rol, negocio:negocios(nombre)')
      .eq('usuario_id', usuario.id)
      .eq('activo', true);

    return (membresias ?? []).map((m: any) => ({
      negocio_id:     m.negocio_id,
      negocio_nombre: m.negocio?.nombre ?? 'Sin nombre',
      rol:            m.rol as 'ADMIN' | 'EMPLEADO'
    }));
  }
}
