import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';

export interface RecargaVirtual {
  id: string;
  fecha: string;
  tipo_servicio_id: number;
  servicio: string;
  monto_virtual: number;
  monto_a_pagar: number;
  ganancia: number;
  pagado: boolean;
  fecha_pago: string | null;
  notas: string | null;
  created_at: string;
}

/**
 * Interface para el retorno de la función unificada de registro de recarga CELULAR (v1.0)
 * Incluye todos los datos necesarios para actualizar la UI sin queries adicionales
 */
export interface RegistroRecargaCompletoResult {
  success: boolean;
  recarga_id: string;
  monto_virtual: number;
  monto_a_pagar: number;
  ganancia: number;
  message: string;
  transferencia: {
    operacion_salida_id: string;
    operacion_entrada_id: string;
    monto_transferido: number;
  };
  saldos_actualizados: {
    caja_celular_anterior: number;
    caja_celular_nuevo: number;
    caja_chica_anterior: number;
    caja_chica_nuevo: number;
    saldo_virtual_celular: number;
  };
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

@Injectable({ providedIn: 'root' })
export class RecargasVirtualesService {
  private supabase = inject(SupabaseService);

  /**
   * Obtiene el porcentaje de comisión de un tipo de servicio desde la BD
   */
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
   * Obtiene las deudas pendientes del proveedor CELULAR (pagado = false)
   */
  async obtenerDeudasPendientesCelular(): Promise<RecargaVirtual[]> {
    const response = await this.supabase.client
      .from('recargas_virtuales')
      .select('*, tipos_servicio!inner(codigo)')
      .eq('tipos_servicio.codigo', 'CELULAR')
      .eq('pagado', false)
      .order('fecha', { ascending: true });

    if (response.error) throw response.error;

    return (response.data || []).map((r: any) => ({
      ...r,
      servicio: r.tipos_servicio.codigo
    }));
  }

  /**
   * Obtiene el historial de recargas virtuales de un servicio
   */
  async obtenerHistorial(servicio: 'CELULAR' | 'BUS'): Promise<RecargaVirtual[]> {
    const response = await this.supabase.client
      .from('recargas_virtuales')
      .select('*, tipos_servicio!inner(codigo)')
      .eq('tipos_servicio.codigo', servicio)
      .order('created_at', { ascending: false })
      .limit(50);

    if (response.error) throw response.error;

    return (response.data || []).map((r: any) => ({
      ...r,
      servicio: r.tipos_servicio.codigo
    }));
  }

  /**
   * Obtiene el saldo actual de una caja específica
   */
  async getSaldoCajaActual(codigoCaja: string): Promise<number> {
    const response = await this.supabase.client
      .from('cajas')
      .select('saldo_actual')
      .eq('codigo', codigoCaja)
      .single();

    if (response.error) throw response.error;
    return response.data?.saldo_actual || 0;
  }

  /**
   * Obtiene el saldo virtual actual de un servicio.
   * Fórmula: último saldo_virtual_actual (cierre diario)
   *        + SUM(monto_virtual de recargas_virtuales registradas DESPUÉS del último cierre)
   *
   * Se usa created_at (no fecha) porque fecha es la fecha del negocio y puede ser
   * de días anteriores. Lo que importa es si ya fue incorporado al cierre o no.
   */
  async getSaldoVirtualActual(servicio: 'CELULAR' | 'BUS'): Promise<number> {
    // 1. Último cierre diario
    const ultimoCierre = await this.supabase.client
      .from('recargas')
      .select('saldo_virtual_actual, created_at, tipos_servicio!inner(codigo)')
      .eq('tipos_servicio.codigo', servicio)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ultimoCierre.error) throw ultimoCierre.error;
    const saldoCierre: number = ultimoCierre.data?.saldo_virtual_actual ?? 0;
    const fechaUltimoCierre: string | null = ultimoCierre.data?.created_at ?? null;

    // 2. Recargas virtuales registradas DESPUÉS del último cierre (aún no incorporadas)
    let query = this.supabase.client
      .from('recargas_virtuales')
      .select('monto_virtual, tipos_servicio!inner(codigo)')
      .eq('tipos_servicio.codigo', servicio);

    if (fechaUltimoCierre) {
      query = query.gt('created_at', fechaUltimoCierre);
    }

    const recargasNuevas = await query;
    if (recargasNuevas.error) throw recargasNuevas.error;

    const sumaNueva: number = (recargasNuevas.data ?? [])
      .reduce((acc: number, r: any) => acc + Number(r.monto_virtual), 0);

    return saldoCierre + sumaNueva;
  }

  /**
   * Registra cuando el proveedor CELULAR carga saldo virtual (versión completa transaccional v1.0)
   *
   * Ejecuta TODO el proceso en una sola transacción atómica:
   * 1. INSERT en recargas_virtuales (crear deuda)
   * 2. CREATE operaciones de transferencia CAJA_CELULAR → CAJA_CHICA
   * 3. UPDATE saldos de ambas cajas
   * 4. CALCULAR saldo virtual actualizado
   * 5. OBTENER lista de deudas pendientes
   *
   * Beneficios:
   * - Transacción atómica (todo o nada) con rollback automático
   * - Reduce round-trips (1 RPC en vez de 4+ queries)
   * - Retorna todos los datos necesarios para actualizar UI
   *
   * @returns {Promise<RegistroRecargaCompletoResult>} Todos los datos actualizados en un solo JSON
   */
  async registrarRecargaProveedorCelularCompleto(params: {
    fecha: string;
    empleado_id: number;
    monto_virtual: number;
  }): Promise<RegistroRecargaCompletoResult> {
    const result = await this.supabase.call<RegistroRecargaCompletoResult>(
      this.supabase.client.rpc('registrar_recarga_proveedor_celular_completo', {
        p_fecha:         params.fecha,
        p_empleado_id:   params.empleado_id,
        p_monto_virtual: params.monto_virtual
      })
    );

    if (!result) {
      throw new Error('Error al registrar recarga: respuesta vacía del servidor');
    }

    return result;
  }

  /**
   * Registra el pago al proveedor CELULAR (EGRESO de CAJA_CELULAR)
   */
  async registrarPagoProveedorCelular(params: {
    empleado_id: number;
    deuda_ids: string[];
    notas?: string;
  }): Promise<any> {
    return this.supabase.call(
      this.supabase.client.rpc('registrar_pago_proveedor_celular', {
        p_empleado_id: params.empleado_id,
        p_deuda_ids:   params.deuda_ids,
        p_notas:       params.notas || null
      })
    );
  }

  /**
   * Registra la compra de saldo virtual BUS (EGRESO inmediato de CAJA_BUS)
   */
  async registrarCompraSaldoBus(params: {
    fecha: string;
    empleado_id: number;
    monto: number;
    notas?: string;
  }): Promise<any> {
    return this.supabase.call(
      this.supabase.client.rpc('registrar_compra_saldo_bus', {
        p_fecha:       params.fecha,
        p_empleado_id: params.empleado_id,
        p_monto:       params.monto,
        p_notas:       params.notas || null
      })
    );
  }

  /**
   * Obtiene el empleado actual desde la sesión
   */
  async obtenerEmpleadoActual(): Promise<{ id: number; nombre: string } | null> {
    const { data: { user } } = await this.supabase.client.auth.getUser();
    if (!user?.email) return null;

    return this.supabase.call<{ id: number; nombre: string }>(
      this.supabase.client
        .from('empleados')
        .select('id, nombre')
        .eq('usuario', user.email)
        .single()
    );
  }

  getFechaLocal(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
}
