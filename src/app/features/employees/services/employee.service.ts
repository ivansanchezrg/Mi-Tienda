import { Injectable, inject } from '@angular/core';
import { SupabaseService } from 'src/app/core/services/supabase.service';
import { Employee } from '../models/employee.model';

@Injectable({ providedIn: 'root' })
export class EmployeeService {
  private supabase = inject(SupabaseService);

  /**
   * Obtiene todos los empleados
   */
  async getAll(): Promise<Employee[] | null> {
    return await this.supabase.call<Employee[]>(
      this.supabase.client.from('empleados').select('*').order('created_at', { ascending: false }),
      'Empleados cargados exitosamente'
    );
  }

  /**
   * Obtiene un empleado por ID
   */
  async getById(id: number): Promise<Employee | null> {
    const result = await this.supabase.call<Employee[]>(
      this.supabase.client.from('empleados').select('*').eq('id', id).single()
    );
    return result ? result[0] : null;
  }
}
