import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { DeudaEmpleado, DeudaEmpleadoConNombre } from '../models/deuda-empleado.model';

@Injectable({
  providedIn: 'root'
})
export class DeudasEmpleadosService {
  private supabase = inject(SupabaseService);

  /**
   * Todas las deudas pendientes, con nombre del empleado.
   * Usar en reportes de nómina o panel de administración.
   */
  async obtenerDeudasPendientes(): Promise<DeudaEmpleadoConNombre[]> {
    return await this.supabase.call<DeudaEmpleadoConNombre[]>(
      this.supabase.client
        .from('deudas_empleados')
        .select('*, empleado:usuarios(id, nombre)')
        .eq('estado', 'PENDIENTE')
        .order('fecha', { ascending: false })
    ) ?? [];
  }

  /**
   * Total de faltantes pendientes de un empleado específico.
   * Útil para conocer cuánto hay que cobrar o descontar en nómina.
   */
  async obtenerTotalPendiente(empleadoId: number): Promise<number> {
    const deudas = await this.supabase.call<DeudaEmpleado[]>(
      this.supabase.client
        .from('deudas_empleados')
        .select('monto_faltante')
        .eq('empleado_id', empleadoId)
        .eq('estado', 'PENDIENTE')
    ) ?? [];

    return deudas.reduce((sum, d) => sum + (d.monto_faltante ?? 0), 0);
  }

  /**
   * Historial completo de deudas de un empleado (todas, sin importar estado).
   * Ordenado por fecha descendente.
   */
  async obtenerHistorialEmpleado(empleadoId: number): Promise<DeudaEmpleado[]> {
    return await this.supabase.call<DeudaEmpleado[]>(
      this.supabase.client
        .from('deudas_empleados')
        .select('*')
        .eq('empleado_id', empleadoId)
        .order('fecha', { ascending: false })
    ) ?? [];
  }
}
