import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { StorageService } from '@core/services/storage.service';
import { UiService } from '@core/services/ui.service';
import { AuthService } from '../../auth/services/auth.service';
import { PAGINATION_CONFIG } from '@core/config/pagination.config';
import { getInicioDiaSiguienteISO, getInicioHaceNDiasISO } from '@core/utils/date.util';
import {
  OperacionCaja,
  OperacionesPaginadas,
  FiltroFecha
} from '../models/operacion-caja.model';
import { CategoriaOperacion } from '../models/categoria-operacion.model';

const HOME_MOVIMIENTOS_LIMIT = 5;

@Injectable({
  providedIn: 'root'
})
export class OperacionesCajaService {
  private supabase = inject(SupabaseService);
  private storageService = inject(StorageService);
  private ui = inject(UiService);
  private authService = inject(AuthService);
  private pageSize = PAGINATION_CONFIG.operacionesCaja.pageSize;

  /** Últimos 5 movimientos del día para el widget del home. Excluye APERTURA y CIERRE. */
  async obtenerUltimosMovimientos(): Promise<OperacionCaja[]> {
    const data = await this.supabase.call<OperacionCaja[]>(
      this.supabase.client
        .from('v_operaciones_cajas')
        .select('id, fecha, tipo_operacion, monto, descripcion, comprobante_url, categoria, caja, empleado')
        .not('tipo_operacion', 'in', '(APERTURA,CIERRE)')
        .gte('fecha', getInicioHaceNDiasISO(0))
        .lt('fecha', getInicioDiaSiguienteISO())
        .order('fecha', { ascending: false })
        .limit(HOME_MOVIMIENTOS_LIMIT)
    );
    return data ?? [];
  }

  async contarMovimientosHoy(): Promise<number> {
    const { count } = await this.supabase.client
      .from('operaciones_cajas')
      .select('id', { count: 'exact', head: true })
      .not('tipo_operacion', 'in', '(APERTURA,CIERRE)')
      .gte('fecha', getInicioHaceNDiasISO(0))
      .lt('fecha', getInicioDiaSiguienteISO());
    return count ?? 0;
  }

  /** Todos los movimientos del día (todas las cajas), paginados. Para el modal de historial del home. */
  async obtenerMovimientosHoy(page: number = 0): Promise<OperacionesPaginadas> {
    const from = page * this.pageSize;
    const to   = from + this.pageSize - 1;
    const result = await this.supabase.client
      .from('v_operaciones_cajas')
      .select('id, fecha, tipo_operacion, monto, descripcion, comprobante_url, categoria, caja, empleado', { count: 'exact' })
      .not('tipo_operacion', 'in', '(APERTURA,CIERRE)')
      .gte('fecha', getInicioHaceNDiasISO(0))
      .lt('fecha', getInicioDiaSiguienteISO())
      .order('fecha', { ascending: false })
      .range(from, to);
    const total = result.count ?? 0;
    return {
      operaciones: (result.data ?? []) as unknown as OperacionCaja[],
      total,
      page,
      pageSize: this.pageSize,
      hasMore: from + this.pageSize < total
    };
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

    // Filtro por fecha — usar utilidades locales para evitar desfase UTC
    if (filtro !== 'todas') {
      const inicioDiaISO = getInicioHaceNDiasISO(0);  // medianoche hoy local → UTC

      const inicioFiltroISO = filtro === 'semana' ? getInicioHaceNDiasISO(7)
                            : filtro === 'mes'    ? getInicioHaceNDiasISO(30)
                            : inicioDiaISO;

      query = query
        .gte('fecha', inicioFiltroISO)
        .lt('fecha', getInicioDiaSiguienteISO());
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
      let pathImagen: string | null = null;

      if (fotoComprobante) {
        await this.ui.showLoading('Subiendo comprobante...');
        pathImagen = await this.storageService.uploadImage(fotoComprobante, 'comprobantes/operaciones');
        await this.ui.hideLoading();

        if (!pathImagen) {
          await this.ui.showError('Error al subir el comprobante. Intenta de nuevo.');
          return false;
        }
      }

      const empleado = await this.authService.getUsuarioActual();
      if (!empleado) {
        await this.ui.showError('No se pudo obtener información del empleado');
        return false;
      }

      await this.ui.showLoading(`Registrando ${tipo.toLowerCase()}...`);

      const { data, error } = await this.supabase.client.rpc('fn_registrar_operacion_manual', {
        p_caja_id: cajaId,
        p_empleado_id: empleado.id,
        p_tipo_operacion: tipo,
        p_categoria_id: categoriaId,
        p_monto: monto,
        p_descripcion: descripcion || null,
        p_comprobante_url: pathImagen
      });

      await this.ui.hideLoading();

      if (error) {
        // Rollback: eliminar imagen huérfana en Storage si el RPC falla
        if (pathImagen) {
          await this.storageService.deleteFile(pathImagen);
        }

        const rawMsg = error.message ?? '';
        const superadminMatch = rawMsg.match(/superadmin_blocked:\s*(.+)/i);
        await this.ui.showError(superadminMatch ? superadminMatch[1].trim() : 'Error al registrar la operación');
        return false;
      }

      if (!data || !data.success) {
        if (pathImagen) await this.storageService.deleteFile(pathImagen);
        await this.ui.showError(data?.error || 'Error al registrar la operación');
        return false;
      }

      await this.ui.showSuccess(`${tipo} registrado correctamente`);
      return true;

    } catch (error) {
      await this.ui.hideLoading();
      await this.ui.showError('Error inesperado');
      return false;
    }
  }
}
