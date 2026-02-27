import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { StorageService } from '@core/services/storage.service';
import { UiService } from '@core/services/ui.service';
import { AuthService } from '../../auth/services/auth.service';
import { GastoDiario, GastoDiarioInput, CategoriaGasto } from '../models/gasto-diario.model';
import { getFechaLocal } from '@core/utils/date.util';

// Tipo interno para el response de Supabase con joins
interface GastoDiarioResponse {
  id: string;
  fecha: string;
  empleado_id: number;
  categoria_gasto_id: number;
  monto: number;
  observaciones: string | null;
  comprobante_url: string | null;
  created_at: string;
  empleados: { id: number; nombre: string } | null;
  categorias_gastos: { id: number; nombre: string; codigo: string } | null;
}

@Injectable({
  providedIn: 'root'
})
export class GastosDiariosService {
  private supabase = inject(SupabaseService);
  private storageService = inject(StorageService);
  private ui = inject(UiService);
  private authService = inject(AuthService);

  /**
   * Registra un nuevo gasto diario
   * @param gasto - Datos del gasto (concepto, monto, observaciones, foto)
   * @returns true si se guardó correctamente, false si hubo error
   */
  async registrarGasto(gasto: GastoDiarioInput): Promise<boolean> {
    try {
      let pathImagen: string | null = null;

      // 1. Si hay foto, subirla primero a Storage
      if (gasto.fotoComprobante) {
        await this.ui.showLoading('Subiendo comprobante...');

        pathImagen = await this.storageService.uploadImage(gasto.fotoComprobante);

        if (!pathImagen) {
          await this.ui.hideLoading();
          await this.ui.showError('Error al subir el comprobante. Intenta de nuevo.');
          return false;
        }

        await this.ui.hideLoading();
      }

      // 2. Obtener empleado actual
      const empleado = await this.authService.getEmpleadoActual();

      if (!empleado) {
        await this.ui.showError('No se pudo obtener información del empleado');
        return false;
      }

      // 3. Obtener fecha local
      const fecha = getFechaLocal();

      // 4. Mostrar loading para guardar gasto
      await this.ui.showLoading('Registrando gasto...');

      // 5. Insertar en tabla gastos_diarios
      const { error } = await this.supabase.client
        .from('gastos_diarios')
        .insert({
          fecha,
          empleado_id: empleado.id,
          categoria_gasto_id: gasto.categoria_gasto_id,
          monto: gasto.monto,
          observaciones: gasto.observaciones || null,
          comprobante_url: pathImagen
        });

      await this.ui.hideLoading();

      if (error) {
        // Si falla y ya subimos la imagen, eliminarla
        if (pathImagen) {
          await this.storageService.deleteFile(pathImagen);
        }

        await this.ui.showError('Error al registrar el gasto');
        return false;
      }

      await this.ui.showSuccess('Gasto registrado correctamente');
      return true;

    } catch {
      await this.ui.hideLoading();
      await this.ui.showError('Error inesperado');
      return false;
    }
  }

  /**
   * Obtiene gastos en un rango de fechas
   * @param fechaInicio - Fecha inicial (YYYY-MM-DD)
   * @param fechaFin - Fecha final (YYYY-MM-DD)
   * @returns Lista de gastos con información del empleado y categoría
   */
  async getGastos(fechaInicio: string, fechaFin: string): Promise<GastoDiario[]> {
    try {
      const { data, error } = await this.supabase.client
        .from('gastos_diarios')
        .select(`
          id,
          fecha,
          empleado_id,
          categoria_gasto_id,
          monto,
          observaciones,
          comprobante_url,
          created_at,
          empleados!inner (
            id,
            nombre
          ),
          categorias_gastos!inner (
            id,
            nombre,
            codigo
          )
        `)
        .gte('fecha', fechaInicio)
        .lte('fecha', fechaFin)
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) return [];

      return (data as unknown as GastoDiarioResponse[] || []).map((gasto) => ({
        ...gasto,
        empleado_nombre: gasto.empleados?.nombre ?? 'Sin nombre',
        categoria_nombre: gasto.categorias_gastos?.nombre ?? 'Sin categoría'
      })) as GastoDiario[];
    } catch {
      return [];
    }
  }

  /**
   * Calcula el total de gastos en un rango de fechas
   * @param fechaInicio - Fecha inicial (YYYY-MM-DD)
   * @param fechaFin - Fecha final (YYYY-MM-DD)
   * @returns Total de gastos
   */
  async getTotalGastos(fechaInicio: string, fechaFin: string): Promise<number> {
    try {
      const { data, error } = await this.supabase.client
        .from('gastos_diarios')
        .select('monto')
        .gte('fecha', fechaInicio)
        .lte('fecha', fechaFin);

      if (error) return 0;

      return (data || []).reduce((total, gasto) => total + gasto.monto, 0);
    } catch {
      return 0;
    }
  }

  /**
   * Obtiene todas las categorías de gastos activas
   * @returns Lista de categorías de gastos
   */
  async getCategorias(): Promise<CategoriaGasto[]> {
    try {
      const { data, error } = await this.supabase.client
        .from('categorias_gastos')
        .select('*')
        .eq('activo', true)
        .order('nombre', { ascending: true });

      if (error) {
        await this.ui.showError('Error al cargar las categorías de gastos');
        return [];
      }

      return data || [];
    } catch {
      await this.ui.showError('Error al cargar las categorías de gastos');
      return [];
    }
  }

  /**
   * Obtiene un gasto por ID
   * @param id - ID del gasto
   * @returns Gasto con información del empleado y categoría
   */
  async getGastoById(id: string): Promise<GastoDiario | null> {
    try {
      const { data, error } = await this.supabase.client
        .from('gastos_diarios')
        .select(`
          id,
          fecha,
          empleado_id,
          categoria_gasto_id,
          monto,
          observaciones,
          comprobante_url,
          created_at,
          empleados!inner (
            id,
            nombre
          ),
          categorias_gastos!inner (
            id,
            nombre,
            codigo
          )
        `)
        .eq('id', id)
        .single();

      if (error || !data) return null;

      const typed = data as unknown as GastoDiarioResponse;
      return {
        ...typed,
        empleado_nombre: typed.empleados?.nombre ?? 'Sin nombre',
        categoria_nombre: typed.categorias_gastos?.nombre ?? 'Sin categoría'
      } as GastoDiario;
    } catch {
      return null;
    }
  }
}
