import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { UiService } from '@core/services/ui.service';

export interface RecargaVirtual {
  id: string;
  fecha: string;
  tipo_servicio_id: number;
  servicio: string;
  empleado_nombre: string | null;
  monto_virtual: number;
  monto_a_pagar: number;
  ganancia: number;
  pagado_proveedor: boolean;
  fecha_pago_proveedor: string | null;
  ganancia_liquidada: boolean;
  fecha_liquidacion_ganancia: string | null;
  observaciones: string | null;
  created_at: string;
}

export interface RegistroRecargaCompletoResult {
  success: boolean;
  recarga_id: string;
  monto_virtual: number;
  monto_a_pagar: number;
  ganancia: number;
  message: string;
  saldo_virtual_celular: number;
  deudas_pendientes: {
    cantidad: number;
    total: number;
    lista: Array<{
      id: string;
      fecha: string;
      monto_virtual: number;
      monto_a_pagar: number;
      ganancia: number;
      created_at: string;
    }>;
  };
}

export interface PagoProveedorResult {
  success: boolean;
  total_pagado: number;
  filas_afectadas: number;
  saldo_caja_celular_nuevo: number;
  message: string;
}

/** Retorno de fn_liquidar_ganancias. */
export interface LiquidacionResult {
  success: boolean;
  total_ganancia: number;
  caja_destino: 'VARIOS' | 'CAJA';
  filas_afectadas: number;
  message: string;
}

/** Retorno de fn_registrar_compra_saldo_bus. */
export interface CompraSaldoBusResult {
  success: boolean;
  recarga_id: string;
  operacion_id: string;
  monto: number;
  saldo_anterior: number;
  saldo_nuevo: number;
  venta_bus_incluida: number;
  mini_cierre: boolean;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class RecargasVirtualesService {
  private supabase = inject(SupabaseService);
  private ui = inject(UiService);

  private saldoInFlight = new Map<string, Promise<number>>();
  private tipoServicioIdCache = new Map<string, number>();
  private tipoServicioInFlight = new Map<string, Promise<number>>();

  private getTipoServicioId(servicio: 'CELULAR' | 'BUS'): Promise<number> {
    if (this.tipoServicioIdCache.has(servicio)) {
      return Promise.resolve(this.tipoServicioIdCache.get(servicio)!);
    }
    if (this.tipoServicioInFlight.has(servicio)) {
      return this.tipoServicioInFlight.get(servicio)!;
    }
    const promise = Promise.resolve(
      this.supabase.client
        .from('tipos_servicio')
        .select('id')
        .eq('codigo', servicio)
        .single()
    ).then(res => {
      if (res.error) throw res.error;
      this.tipoServicioIdCache.set(servicio, res.data.id);
      return res.data.id as number;
    }).finally(() => this.tipoServicioInFlight.delete(servicio));
    this.tipoServicioInFlight.set(servicio, promise);
    return promise;
  }

  async getPorcentajeComision(servicio: 'CELULAR' | 'BUS'): Promise<number> {
    const response = await this.supabase.client
      .from('tipos_servicio')
      .select('porcentaje_comision')
      .eq('codigo', servicio)
      .single();

    if (response.error) throw response.error;
    return response.data?.porcentaje_comision ?? 5;
  }

  /**
   * Deudas sin pagar al proveedor CELULAR (pagado_proveedor=false).
   * Usadas para la acción "Pagar al proveedor".
   * BUS: sin paso intermedio, no tiene deudas en este sentido.
   */
  async obtenerDeudasCelular(): Promise<RecargaVirtual[]> {
    const tipoId = await this.getTipoServicioId('CELULAR');
    const response = await this.supabase.client
      .from('recargas_virtuales')
      .select('*')
      .eq('tipo_servicio_id', tipoId)
      .eq('pagado_proveedor', false)
      .order('fecha', { ascending: true });

    if (response.error) throw response.error;

    return (response.data || []).map((r: any) => ({ ...r, servicio: 'CELULAR' }));
  }

  /**
   * Filas pendientes de liquidar ganancia de un servicio.
   * Ambos servicios: pagado_proveedor=true AND ganancia_liquidada=false — mismo
   * filtro que fn_liquidar_ganancias (BD), desde su unificación v2.0. BUS no tiene
   * paso intermedio de pago a proveedor: nace directo en pagado_proveedor=true
   * (fn_registrar_compra_saldo_bus v4.1).
   */
  async obtenerPendientes(servicio: 'CELULAR' | 'BUS'): Promise<RecargaVirtual[]> {
    const tipoId = await this.getTipoServicioId(servicio);
    const response = await this.supabase.client
      .from('recargas_virtuales')
      .select('*')
      .eq('tipo_servicio_id', tipoId)
      .eq('ganancia_liquidada', false)
      .eq('pagado_proveedor', true)
      .order('fecha', { ascending: true });

    if (response.error) throw response.error;

    return (response.data || []).map((r: any) => ({ ...r, servicio }));
  }

  async obtenerHistorial(servicio: 'CELULAR' | 'BUS'): Promise<RecargaVirtual[]> {
    const tipoId = await this.getTipoServicioId(servicio);
    const response = await this.supabase.client
      .from('recargas_virtuales')
      .select('*, usuarios(nombre)')
      .eq('tipo_servicio_id', tipoId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (response.error) throw response.error;

    return (response.data || []).map((r: any) => ({
      ...r,
      servicio,
      empleado_nombre: r.usuarios?.nombre ?? null
    }));
  }

  async getSaldoCajaActual(codigoCaja: string): Promise<number> {
    const response = await this.supabase.client
      .from('cajas')
      .select('saldo_actual')
      .eq('codigo', codigoCaja)
      .maybeSingle();

    if (response.error) throw response.error;
    return response.data?.saldo_actual ?? 0;
  }

  async getSaldoVirtualActual(servicio: 'CELULAR' | 'BUS'): Promise<number> {
    if (this.saldoInFlight.has(servicio)) {
      return this.saldoInFlight.get(servicio)!;
    }

    const promise = this._fetchSaldoVirtualActual(servicio).finally(() => {
      this.saldoInFlight.delete(servicio);
    });

    this.saldoInFlight.set(servicio, promise);
    return promise;
  }

  private async _fetchSaldoVirtualActual(servicio: 'CELULAR' | 'BUS'): Promise<number> {
    const tipoId = await this.getTipoServicioId(servicio);

    const snapshot = await this.supabase.client
      .from('recargas')
      .select('saldo_virtual_actual, created_at')
      .eq('tipo_servicio_id', tipoId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (snapshot.error) throw snapshot.error;

    const saldoBase  = snapshot.data?.saldo_virtual_actual ?? 0;
    const fechaCorte = snapshot.data?.created_at ?? '1900-01-01T00:00:00Z';

    const postSnapshot = await this.supabase.client
      .from('recargas_virtuales')
      .select('monto_virtual')
      .eq('tipo_servicio_id', tipoId)
      .gt('created_at', fechaCorte);

    if (postSnapshot.error) throw postSnapshot.error;

    const sumaPost = (postSnapshot.data ?? []).reduce(
      (s: number, r: any) => s + (r.monto_virtual ?? 0), 0
    );

    return saldoBase + sumaPost;
  }

  async registrarRecargaProveedorCelular(params: {
    fecha: string;
    empleado_id: string;
    monto_virtual: number;
  }): Promise<RegistroRecargaCompletoResult> {
    const result = await this.supabase.call<RegistroRecargaCompletoResult>(
      this.supabase.client.rpc('fn_registrar_recarga_proveedor_celular', {
        p_fecha: params.fecha,
        p_empleado_id: params.empleado_id,
        p_monto_virtual: params.monto_virtual
      }),
      undefined,
      { showLoading: true }
    );

    if (!result) {
      throw new Error('Error al registrar recarga: respuesta vacía del servidor');
    }

    return result;
  }

  async pagarProveedorCelular(empleadoId: string, idsRecargas: string[]): Promise<PagoProveedorResult> {
    const result = await this.supabase.call<PagoProveedorResult>(
      this.supabase.client.rpc('fn_pagar_proveedor_celular', {
        p_empleado_id:  empleadoId,
        p_ids_recargas: idsRecargas
      }),
      undefined,
      { showLoading: true }
    );

    if (!result) {
      throw new Error('Error al registrar pago al proveedor: respuesta vacía del servidor');
    }

    return result;
  }

  /**
   * Liquida toda la ganancia pendiente de CELULAR o BUS. Atómico: todo o nada.
   * Ambos servicios: filtra pagado_proveedor=false, marca pagado+liquidado en un paso.
   * Caja destino calculada por el SQL: VARIOS si está activa, sino CAJA (Tienda).
   */
  async liquidarGanancias(servicio: 'CELULAR' | 'BUS', empleadoId: string): Promise<LiquidacionResult | null> {
    // result === null → supabase.call() ya mostró el toast con el mensaje real del
    // RAISE EXCEPTION (ej. "No hay ganancias CELULAR pendientes de liquidar"). El caller
    // no debe mostrar un segundo toast genérico — solo propagar null para abortar en silencio.
    return this.supabase.call<LiquidacionResult>(
      this.supabase.client.rpc('fn_liquidar_ganancias', {
        p_servicio:    servicio,
        p_empleado_id: empleadoId
      }),
      undefined,
      { showLoading: true }
    );
  }

  async registrarCompraSaldoBus(params: {
    fecha: string;
    empleado_id: string;
    monto: number;
    observaciones?: string;
    saldo_virtual_maquina?: number;
  }): Promise<CompraSaldoBusResult | null> {
    await this.ui.showLoading();
    try {
      const response = await this.supabase.client.rpc('fn_registrar_compra_saldo_bus', {
        p_fecha: params.fecha,
        p_empleado_id: params.empleado_id,
        p_monto: params.monto,
        p_observaciones: params.observaciones || null,
        p_saldo_virtual_maquina: params.saldo_virtual_maquina ?? null
      });

      // Reemplazar mensaje técnico de turno por texto legible antes de que call() lo muestre
      if (response.error) {
        const raw: string = response.error.message ?? '';
        if (raw.toLowerCase().includes('turno')) {
          response.error.message = 'Debes tener un turno abierto. Ve a Inicio y abre el turno primero.';
        }
      }

      return await this.supabase.call<CompraSaldoBusResult>(Promise.resolve(response));
    } finally {
      await this.ui.hideLoading();
    }
  }
}
