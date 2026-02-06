import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { StorageService } from '@core/services/storage.service';
import { UiService } from '@core/services/ui.service';
import { AuthService } from '../../auth/services/auth.service';
import { PAGINATION_CONFIG } from '@core/config/pagination.config';
import {
  OperacionCaja,
  OperacionesPaginadas,
  FiltroFecha
} from '../models/operacion-caja.model';

@Injectable({
  providedIn: 'root'
})
export class OperacionesCajaService {
  private supabase = inject(SupabaseService);
  private storageService = inject(StorageService);
  private ui = inject(UiService);
  private authService = inject(AuthService);
  private pageSize = PAGINATION_CONFIG.operacionesCaja.pageSize;

  /**
   * Obtiene operaciones de una caja con paginación
   */
  async obtenerOperacionesCaja(
    cajaId: number,
    filtro: FiltroFecha = 'hoy',
    page: number = 0
  ): Promise<OperacionesPaginadas> {
    const from = page * this.pageSize;
    const to = from + this.pageSize - 1;

    let query = this.supabase.client
      .from('operaciones_cajas')
      .select(`
        *,
        caja:cajas!inner(id, nombre, codigo),
        empleado:empleados(id, nombre)
      `, { count: 'exact' })
      .eq('caja_id', cajaId)
      .order('fecha', { ascending: false });

    // Filtro por fecha
    if (filtro !== 'todas') {
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      const manana = new Date(hoy);
      manana.setDate(manana.getDate() + 1);

      let fechaInicio: Date;

      switch (filtro) {
        case 'hoy':
          fechaInicio = hoy;
          break;
        case 'semana':
          fechaInicio = new Date(hoy);
          fechaInicio.setDate(fechaInicio.getDate() - 7);
          break;
        case 'mes':
          fechaInicio = new Date(hoy);
          fechaInicio.setMonth(fechaInicio.getMonth() - 1);
          break;
        default:
          fechaInicio = hoy;
      }

      query = query
        .gte('fecha', fechaInicio.toISOString())
        .lt('fecha', manana.toISOString());
    }

    // Paginación
    const { data, count, error } = await query.range(from, to);

    if (error) {
      throw new Error(`Error al obtener operaciones: ${error.message}`);
    }

    return {
      operaciones: data || [],
      total: count || 0,
      page,
      pageSize: this.pageSize,
      hasMore: (count || 0) > to + 1
    };
  }

  /**
   * Registra una nueva operación de INGRESO o EGRESO
   * @param cajaId - ID de la caja
   * @param tipo - 'INGRESO' o 'EGRESO'
   * @param monto - Monto de la operación
   * @param descripcion - Descripción opcional
   * @param fotoComprobante - DataURL de la foto (null si no hay)
   * @returns true si se guardó correctamente, false si hubo error
   */
  async registrarOperacion(
    cajaId: number,
    tipo: 'INGRESO' | 'EGRESO',
    monto: number,
    descripcion: string,
    fotoComprobante: string | null
  ): Promise<boolean> {
    try {
      let pathImagen: string | null = null;

      // 1. Si hay foto, subirla primero a Storage
      if (fotoComprobante) {
        await this.ui.showLoading('Subiendo comprobante...');

        pathImagen = await this.storageService.uploadImage(fotoComprobante);

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

      // 3. Mostrar loading para guardar operación
      await this.ui.showLoading(`Registrando ${tipo.toLowerCase()}...`);

      // 4. Llamar a la función PostgreSQL que maneja todo
      // Guardamos el PATH, no la URL (más flexible para generar signed URLs después)
      const { data, error } = await this.supabase.client.rpc('registrar_operacion_manual', {
        p_caja_id: cajaId,
        p_empleado_id: empleado.id,
        p_tipo_operacion: tipo,
        p_monto: monto,
        p_descripcion: descripcion || null,
        p_comprobante_url: pathImagen  // ← Guardamos PATH, no URL
      });

      await this.ui.hideLoading();

      // Verificar si hubo error en la llamada RPC
      if (error) {
        console.error('Error al llamar RPC:', error);

        // Si falla y ya subimos la imagen, eliminarla
        if (pathImagen) {
          await this.storageService.deleteFile(pathImagen);
        }

        await this.ui.showError('Error al registrar la operación');
        return false;
      }

      // Verificar el resultado de la función
      if (!data || !data.success) {
        console.error('Error en la función:', data?.error);

        // Si falla y ya subimos la imagen, eliminarla
        if (pathImagen) {
          await this.storageService.deleteFile(pathImagen);
        }

        await this.ui.showError(data?.error || 'Error al registrar la operación');
        return false;
      }

      await this.ui.showSuccess(`${tipo} registrado correctamente`);
      return true;

    } catch (error) {
      console.error('Error en registrarOperacion:', error);
      await this.ui.hideLoading();
      await this.ui.showError('Error inesperado');
      return false;
    }
  }
}
