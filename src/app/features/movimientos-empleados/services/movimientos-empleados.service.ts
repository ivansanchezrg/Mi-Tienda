import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { PAGINATION_CONFIG } from '@core/config/pagination.config';
import {
  MovimientoEmpleado, SaldoEmpleado, PreviewNomina,
  ResultadoAdelanto, ResultadoPagoNomina, DetalleDescuento
} from '../models/movimiento-empleado.model';

@Injectable({
  providedIn: 'root'
})
export class MovimientosEmpleadosService {
  private supabase = inject(SupabaseService);

  // ── Queries directas ──

  /** Lista de saldos de todos los empleados activos (vista v_saldos_empleados) */
  async obtenerResumenCuentas(): Promise<SaldoEmpleado[]> {
    return await this.supabase.call<SaldoEmpleado[]>(
      this.supabase.client
        .from('v_saldos_empleados')
        .select('*')
        .order('nombre')
    ) ?? [];
  }

  /** Datos del empleado desde la vista (nombre + saldo). Retorna null si no existe. */
  async obtenerEmpleado(empleadoId: number): Promise<SaldoEmpleado | null> {
    return await this.supabase.call<SaldoEmpleado>(
      this.supabase.client
        .from('v_saldos_empleados')
        .select('*')
        .eq('empleado_id', empleadoId)
        .maybeSingle()
    ) ?? null;
  }

  /** Historial paginado de movimientos de un empleado */
  async obtenerHistorialEmpleado(
    empleadoId: number,
    page: number,
    estado?: 'PENDIENTE' | 'LIQUIDADO'
  ): Promise<MovimientoEmpleado[]> {
    const pageSize = PAGINATION_CONFIG.movimientosEmpleados.pageSize;
    const from = page * pageSize;
    const to = from + pageSize - 1;

    let query = this.supabase.client
      .from('movimientos_empleados')
      .select('*')
      .eq('empleado_id', empleadoId)
      .order('fecha', { ascending: false })
      .range(from, to);

    if (estado) {
      query = query.eq('estado_liquidacion', estado);
    }

    return await this.supabase.call<MovimientoEmpleado[]>(query) ?? [];
  }

  /** Ajustar cuenta — INSERT directo (1 tabla) */
  async ajustarCuenta(
    beneficiarioId: number,
    monto: number,
    tipo: 'AJUSTE_ABONO' | 'AJUSTE_CARGO',
    descripcion: string,
    creadoPor: number
  ): Promise<boolean> {
    const result = await this.supabase.call(
      this.supabase.client
        .from('movimientos_empleados')
        .insert({
          empleado_id: beneficiarioId,
          tipo_movimiento: tipo,
          monto,
          descripcion,
          creado_por: creadoPor
        }),
      tipo === 'AJUSTE_CARGO' ? 'Cargo registrado' : 'Abono registrado'
    );
    return result !== undefined;
  }

  /**
   * Preview de nomina — solo lectura, calcula en TypeScript.
   * Muestra al admin que pasaria antes de confirmar.
   */
  async calcularPreviewNomina(beneficiarioId: number, sueldoBase: number): Promise<PreviewNomina> {
    // Queries paralelas: descuentos pendientes + saldos de cajas
    const [pendientesRaw, cajasRaw] = await Promise.all([
      this.supabase.call<MovimientoEmpleado[]>(
        this.supabase.client
          .from('movimientos_empleados')
          .select('tipo_movimiento, monto, fecha, descripcion')
          .eq('empleado_id', beneficiarioId)
          .eq('estado_liquidacion', 'PENDIENTE')
          .in('tipo_movimiento', ['FALTANTE_CAJA', 'ADELANTO_SUELDO', 'AJUSTE_CARGO'])
          .order('fecha', { ascending: true })
      ),
      this.supabase.call<{ codigo: string; saldo_actual: number }[]>(
        this.supabase.client
          .from('cajas')
          .select('codigo, saldo_actual')
          .in('codigo', ['VARIOS', 'CAJA'])
      )
    ]);
    const pendientes = pendientesRaw ?? [];
    const cajas = cajasRaw ?? [];

    // Todos los movimientos traidos ya son descuentos (FALTANTE_CAJA, ADELANTO_SUELDO, AJUSTE_CARGO)
    const descuentos: DetalleDescuento[] = pendientes
      .map(m => ({
        tipo: m.tipo_movimiento,
        monto: m.monto,
        fecha: m.fecha,
        descripcion: m.descripcion ?? ''
      }));

    const totalDescuentos = descuentos.reduce((sum, d) => sum + d.monto, 0);
    const liquido = sueldoBase - totalDescuentos;

    const saldoVarios = cajas.find(c => c.codigo === 'VARIOS')?.saldo_actual ?? 0;
    const saldoCaja = cajas.find(c => c.codigo === 'CAJA')?.saldo_actual ?? 0;

    // Distribucion: VARIOS primero, luego CAJA
    const montoDeVarios = liquido > 0 ? Math.min(liquido, saldoVarios) : 0;
    const montoDeCaja = liquido > 0 ? liquido - montoDeVarios : 0;
    const fondosSuficientes = liquido <= 0 || montoDeCaja <= saldoCaja;

    return {
      sueldoBase,
      descuentos,
      totalDescuentos,
      liquido,
      saldoVarios,
      saldoCaja,
      montoDeVarios,
      montoDeCaja,
      fondosSuficientes
    };
  }

  // ── RPCs atomicas ──

  /** Registrar adelanto de sueldo (atomico: cajas + movimiento). No requiere turno abierto. */
  async registrarAdelanto(params: {
    empleadoId: number;
    beneficiarioId: number;
    monto: number;
    descripcion?: string;
    comprobanteUrl?: string;
  }): Promise<ResultadoAdelanto> {
    const result = await this.supabase.call<ResultadoAdelanto>(
      this.supabase.client.rpc('fn_registrar_adelanto_sueldo', {
        p_empleado_id: params.empleadoId,
        p_beneficiario_id: params.beneficiarioId,
        p_monto: params.monto,
        p_descripcion: params.descripcion ?? null,
        p_comprobante_url: params.comprobanteUrl ?? null
      })
    );
    return result ?? { success: false, error: 'Error de conexion' };
  }

  /** Pagar nomina (atomico: sueldo + descuentos + cajas + liquidacion). No requiere turno abierto. */
  async pagarNomina(params: {
    empleadoId: number;
    beneficiarioId: number;
    sueldoBase: number;
    descripcion?: string;
    comprobanteUrl?: string;
  }): Promise<ResultadoPagoNomina> {
    const result = await this.supabase.call<ResultadoPagoNomina>(
      this.supabase.client.rpc('fn_pagar_nomina_empleado', {
        p_empleado_id: params.empleadoId,
        p_beneficiario_id: params.beneficiarioId,
        p_sueldo_base: params.sueldoBase,
        p_descripcion: params.descripcion ?? null,
        p_comprobante_url: params.comprobanteUrl ?? null
      })
    );
    return result ?? { success: false, error: 'Error de conexion' };
  }
}
