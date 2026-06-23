import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { NegocioDisponible } from './auth.service';

@Injectable({ providedIn: 'root' })
export class NegocioService {
  private supabase = inject(SupabaseService);

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
      negocio_nombre: m.negocio?.nombre ?? '',
      rol:            m.rol as 'ADMIN' | 'EMPLEADO'
    })).filter(n => n.negocio_nombre !== '');
  }
}
