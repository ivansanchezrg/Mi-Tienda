import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { StorageService } from '@core/services/storage.service';
import { UiService } from '@core/services/ui.service';
import { FeedbackOverlayService } from '@core/services/feedback-overlay.service';
import { CurrencyService } from '@core/services/currency.service';
import { AuthService } from '../../auth/services/auth.service';
import { PAGINATION_CONFIG } from '@core/config/pagination.config';
import { getInicioDiaSiguienteISO, getInicioHaceNDiasISO } from '@core/utils/date.util';
import {
  OperacionCaja,
  OperacionesPaginadas,
  FiltroFecha
} from '../models/operacion-caja.model';
import { CategoriaOperacion } from '../models/categoria-operacion.model';

@Injectable({
  providedIn: 'root'
})
export class OperacionesCajaService {
  private supabase = inject(SupabaseService);
  private storageService = inject(StorageService);
  private ui = inject(UiService);
  private feedback = inject(FeedbackOverlayService);
  private currency = inject(CurrencyService);
  private authService = inject(AuthService);
  private pageSize = PAGINATION_CONFIG.operacionesCaja.pageSize;

  /**
   * Rango de fechas [desde, hasta) en ISO UTC para un filtro, o null si es 'todas'
   * (sin acotar). Única fuente del rango — lista y resumen lo comparten para que
   * siempre cubran exactamente el mismo período.
   */
  private rangoFiltro(filtro: FiltroFecha): { desde: string; hasta: string } | null {
    if (filtro === 'todas') return null;

    const desde = filtro === 'semana' ? getInicioHaceNDiasISO(7)
                : filtro === 'mes'    ? getInicioHaceNDiasISO(30)
                : getInicioHaceNDiasISO(0);

    return { desde, hasta: getInicioDiaSiguienteISO() };
  }

  async obtenerCategorias(tipo?: 'INGRESO' | 'EGRESO'): Promise<CategoriaOperacion[]> {
    let query = this.supabase.client
      .from('categorias_operaciones')
      .select('*')
      .eq('activo', true)
      .order('codigo', { ascending: true });

    if (tipo) {
      query = query.eq('tipo', tipo);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Error al obtener categorías: ${error.message}`);
    }

    return data || [];
  }

  async obtenerOperacionesCaja(
    cajaId: string,
    filtro: FiltroFecha = 'hoy',
    page: number = 0
  ): Promise<OperacionesPaginadas> {
    const from = page * this.pageSize;
    const to = from + this.pageSize - 1;

    let query = this.supabase.client
      .from('v_operaciones_cajas')
      .select('*', { count: 'exact' })
      .eq('caja_id', cajaId)
      .order('fecha', { ascending: false });

    // Filtro por fecha — rango compartido con el resumen (evita desfase UTC)
    const rango = this.rangoFiltro(filtro);
    if (rango) {
      query = query
        .gte('fecha', rango.desde)
        .lt('fecha', rango.hasta);
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

  async obtenerResumenOperaciones(cajaId: string, filtro: FiltroFecha): Promise<{ totalIngresos: number; totalEgresos: number }> {
    const rango = this.rangoFiltro(filtro);

    const { data, error } = await this.supabase.client.rpc('fn_resumen_operaciones_caja', {
      p_caja_id: cajaId,
      p_desde: rango?.desde ?? null,
      p_hasta: rango?.hasta ?? null
    });

    if (error) {
      throw new Error(`Error al obtener el resumen: ${error.message}`);
    }

    const fila = data?.[0];
    return {
      totalIngresos: fila?.total_ingresos ?? 0,
      totalEgresos: fila?.total_egresos ?? 0
    };
  }

  async actualizarComprobante(operacionId: string, newImageUrl: string, oldPath: string | null): Promise<boolean> {
    const newPath = await this.storageService.replaceImage(newImageUrl, 'comprobantes/operaciones', oldPath);
    if (!newPath) return false;

    const { error } = await this.supabase.client
      .from('operaciones_cajas')
      .update({ comprobante_url: newPath })
      .eq('id', operacionId);

    if (error) {
      await this.storageService.deleteFile(newPath);
      await this.ui.showError('Error al actualizar el comprobante');
      return false;
    }

    return true;
  }

  async registrarTransferencia(
    codigoOrigen:  string,
    codigoDestino: string,
    monto:         number,
    descripcion:   string
  ): Promise<{ ok: boolean; saldoInsuficiente?: boolean; errorMsg?: string }> {
    try {
      const empleado = await this.authService.getUsuarioActual();
      if (!empleado) {
        await this.ui.showError('No se pudo obtener información del empleado');
        return { ok: false };
      }

      await this.ui.showLoading('Realizando traspaso...');

      const { data, error } = await this.supabase.client.rpc('fn_crear_transferencia', {
        p_codigo_origen:  codigoOrigen,
        p_codigo_destino: codigoDestino,
        p_monto:          monto,
        p_empleado_id:    empleado.id,
        p_descripcion:    descripcion || null,
      });

      await this.ui.hideLoading();

      if (error) {
        const rawMsg = error.message ?? '';
        const superadminMatch = rawMsg.match(/superadmin_blocked:\s*(.+)/i);
        await this.ui.showError(superadminMatch ? superadminMatch[1].trim() : 'Error al realizar el traspaso');
        return { ok: false };
      }

      if (!data || !data.success) {
        const msg: string = data?.error || 'Error al realizar el traspaso';
        const esSaldoInsuficiente = msg.toLowerCase().includes('saldo insuficiente');
        if (!esSaldoInsuficiente) await this.ui.showError(msg);
        return { ok: false, saldoInsuficiente: esSaldoInsuficiente, errorMsg: msg };
      }

      await this.ui.showSuccess('Traspaso realizado correctamente');
      return { ok: true };
    } catch {
      await this.ui.hideLoading();
      await this.ui.showError('Error inesperado');
      return { ok: false };
    }
  }

  async registrarOperacion(
    cajaId: string,
    tipo: 'INGRESO' | 'EGRESO',
    categoriaId: string,
    monto: number,
    descripcion: string,
    fotoComprobante: string | null
  ): Promise<boolean> {
    try {
      // Empleado ANTES del upload: si falla aquí (lectura local, barata) no se
      // sube nada — evita dejar una imagen huérfana en Storage sin registro en BD.
      const empleado = await this.authService.getUsuarioActual();
      if (!empleado) {
        await this.ui.showError('No se pudo obtener información del empleado');
        return false;
      }

      // Nota: no se usa ui.showLoading() en este flujo — el modal de operación
      // (OperacionModalComponent) muestra su propio spinner "Registrando..." mientras
      // espera este método (patrón onConfirmar). Un ion-loading global encima del modal
      // sería un doble indicador solapado.
      let pathImagen: string | null = null;

      if (fotoComprobante) {
        pathImagen = await this.storageService.uploadImage(fotoComprobante, 'comprobantes/operaciones');

        if (!pathImagen) {
          this.feedback.error({
            titulo: `No se pudo registrar el ${tipo.toLowerCase()}`,
            subtitulo: 'Error al subir el comprobante. Intenta de nuevo.',
          });
          return false;
        }
      }

      const { data, error } = await this.supabase.client.rpc('fn_registrar_operacion_manual', {
        p_caja_id: cajaId,
        p_empleado_id: empleado.id,
        p_tipo_operacion: tipo,
        p_categoria_id: categoriaId,
        p_monto: monto,
        p_descripcion: descripcion || null,
        p_comprobante_url: pathImagen
      });

      if (error) {
        // Rollback: eliminar imagen huérfana en Storage si el RPC falla
        if (pathImagen) {
          await this.storageService.deleteFile(pathImagen);
        }

        // supabase-js NO lanza en fallo de red — lo devuelve en `error`. Distinguir el
        // "sin conexión" del error de negocio: el RPC directo no pasa por call(), así que
        // hay que detectar el error de transporte manualmente y dar el mensaje REAL.
        const rawMsg = error.message ?? '';
        const superadminMatch = rawMsg.match(/superadmin_blocked:\s*(.+)/i);
        // Transacción financiera real (mismo peso que la venta del POS) — el
        // empleado necesita certeza de que el dinero NO quedó registrado, no un
        // toast que puede perderse. Ver design_toast_vs_overlay_feedback.md.
        this.feedback.error({
          titulo: `No se pudo registrar el ${tipo.toLowerCase()}`,
          subtitulo: superadminMatch
            ? superadminMatch[1].trim()
            : this.supabase.esErrorDeTransporte(error)
              ? 'Sin conexión a internet. Verifica tu red e intenta de nuevo.'
              : rawMsg || undefined,
        });
        return false;
      }

      if (!data || !data.success) {
        if (pathImagen) await this.storageService.deleteFile(pathImagen);
        this.feedback.error({
          titulo: `No se pudo registrar el ${tipo.toLowerCase()}`,
          subtitulo: data?.error,
        });
        return false;
      }

      this.feedback.success({
        titulo: `${tipo === 'INGRESO' ? 'Ingreso' : 'Egreso'} registrado`,
        destacado: `$${this.currency.format(monto)}`,
      });
      return true;

    } catch (error) {
      this.feedback.error({
        titulo: `No se pudo registrar el ${tipo.toLowerCase()}`,
        subtitulo: this.supabase.esErrorDeTransporte(error)
          ? 'Sin conexión a internet. Verifica tu red e intenta de nuevo.'
          : 'Error inesperado. Intenta de nuevo.',
      });
      return false;
    }
  }
}
