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

/** Retorno de fn_liquidar_ganancias. */
export interface LiquidacionResult {
  success: boolean;
  total_ganancia: number;
  caja_destino: 'VARIOS' | 'CAJA';
  filas_afectadas: number;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class RecargasVirtualesService {
  private supabase = inject(SupabaseService);
  private ui = inject(UiService);

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
   * Filas pendientes de liquidar (pagado_proveedor=false) de un servicio.
   * Usadas para el acordeón de desglose en la card "Liquidar Ganancia".
   */
  async obtenerPendientes(servicio: 'CELULAR' | 'BUS'): Promise<RecargaVirtual[]> {
    const response = await this.supabase.client
      .from('recargas_virtuales')
      .select('*, tipos_servicio!inner(codigo)')
      .eq('tipos_servicio.codigo', servicio)
      .eq('pagado_proveedor', false)
      .order('fecha', { ascending: true });

    if (response.error) throw response.error;

    return (response.data || []).map((r: any) => ({
      ...r,
      servicio: r.tipos_servicio.codigo
    }));
  }

  async obtenerHistorial(servicio: 'CELULAR' | 'BUS'): Promise<RecargaVirtual[]> {
    const response = await this.supabase.client
      .from('recargas_virtuales')
      .select('*, tipos_servicio!inner(codigo), usuarios!inner(nombre)')
      .eq('tipos_servicio.codigo', servicio)
      .order('created_at', { ascending: false })
      .limit(50);

    if (response.error) throw response.error;

    return (response.data || []).map((r: any) => ({
      ...r,
      servicio: r.tipos_servicio.codigo,
      empleado_nombre: r.usuarios?.nombre ?? null
    }));
  }

  async getSaldoCajaActual(codigoCaja: string): Promise<number> {
    const response = await this.supabase.client
      .from('cajas')
      .select('saldo_actual')
      .eq('codigo', codigoCaja)
      .single();

    if (response.error) throw response.error;
    return response.data?.saldo_actual ?? 0;
  }

  /**
   * Saldo virtual del último snapshot en `recargas` para un servicio.
   * Usado exclusivamente en el cuadre — no suma recargas posteriores al snapshot.
   */
  async getSaldoUltimoCierre(servicio: 'CELULAR' | 'BUS'): Promise<number> {
    const result = await this.supabase.client
      .from('recargas')
      .select('saldo_virtual_actual, tipos_servicio!inner(codigo)')
      .eq('tipos_servicio.codigo', servicio)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (result.error) throw result.error;
    return result.data?.saldo_virtual_actual ?? 0;
  }

  async getSaldoVirtualActual(servicio: 'CELULAR' | 'BUS'): Promise<number> {
    return this.getSaldoUltimoCierre(servicio);
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

  /**
   * Liquida toda la ganancia pendiente de CELULAR o BUS. Atómico: todo o nada.
   * Ambos servicios: filtra pagado_proveedor=false, marca pagado+liquidado en un paso.
   * Caja destino calculada por el SQL: VARIOS si está activa, sino CAJA (Tienda).
   */
  async liquidarGanancias(servicio: 'CELULAR' | 'BUS', empleadoId: string): Promise<LiquidacionResult> {
    const result = await this.supabase.call<LiquidacionResult>(
      this.supabase.client.rpc('fn_liquidar_ganancias', {
        p_servicio:    servicio,
        p_empleado_id: empleadoId
      }),
      undefined,
      { showLoading: true }
    );

    if (!result) {
      throw new Error(`Error al liquidar ganancias ${servicio}: respuesta vacía del servidor`);
    }

    return result;
  }

  async registrarCompraSaldoBus(params: {
    fecha: string;
    empleado_id: string;
    monto: number;
    observaciones?: string;
    saldo_virtual_maquina?: number;
  }): Promise<any> {
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

      return await this.supabase.call(Promise.resolve(response));
    } finally {
      await this.ui.hideLoading();
    }
  }
}
