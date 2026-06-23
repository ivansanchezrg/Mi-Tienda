import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { AuthService } from '../../auth/services/auth.service';
import { PAGINATION_CONFIG } from '@core/config/pagination.config';
import {
  MovimientoEmpleado, SaldoEmpleado, PreviewNomina,
  ResultadoAdelanto, ResultadoPagoNomina, DetalleDescuento,
  ProporcionalInfo
} from '../models/movimiento-empleado.model';

@Injectable({
  providedIn: 'root'
})
export class MovimientosEmpleadosService {
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);

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

  /**
   * Datos del empleado (nombre + saldo).
   * Intenta la vista primero (empleados activos). Si no aparece (fue transferido,
   * tiene activo=FALSE pero puede tener movimientos pendientes), cae a query
   * directa sobre usuarios + movimientos para construir el SaldoEmpleado.
   */
  async obtenerEmpleado(empleadoId: string): Promise<SaldoEmpleado | null> {
    // 1. Buscar en la vista (empleados activos del negocio)
    const enVista = await this.supabase.call<SaldoEmpleado>(
      this.supabase.client
        .from('v_saldos_empleados')
        .select('*')
        .eq('empleado_id', empleadoId)
        .maybeSingle()
    ) ?? null;

    if (enVista) return enVista;

    // 2. No está en la vista (inactivo/transferido) — construir desde tablas base
    const usuario = await this.supabase.call<{ id: string; nombre: string }>(
      this.supabase.client
        .from('usuarios')
        .select('id, nombre')
        .eq('id', empleadoId)
        .maybeSingle()
    ) ?? null;

    if (!usuario) return null;

    // Calcular saldo desde movimientos pendientes del negocio actual
    const movs = await this.supabase.call<{ tipo_movimiento: string; monto: number }[]>(
      this.supabase.client
        .from('movimientos_empleados')
        .select('tipo_movimiento, monto')
        .eq('empleado_id', empleadoId)
        .eq('estado_liquidacion', 'PENDIENTE')
    ) ?? [];

    const saldo = movs.reduce((acc, m) => {
      const abono = ['SUELDO_BASE', 'BONO_COMISION', 'AJUSTE_ABONO'].includes(m.tipo_movimiento);
      return acc + (abono ? m.monto : -m.monto);
    }, 0);

    return { empleado_id: usuario.id as any, nombre: usuario.nombre, saldo };
  }

  /** Historial paginado de movimientos de un empleado */
  async obtenerHistorialEmpleado(
    empleadoId: string,
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
    beneficiarioId: string,
    monto: number,
    tipo: 'AJUSTE_ABONO' | 'AJUSTE_CARGO',
    descripcion: string,
    creadoPor: string
  ): Promise<boolean> {
    const negocioId = this.auth.usuarioActualValue?.negocio_id;

    // Usamos .select() para que Supabase retorne la fila insertada.
    // Sin .select(), data=null tanto en éxito como en error RLS — indistinguibles.
    const result = await this.supabase.call<{ id: string }[]>(
      this.supabase.client
        .from('movimientos_empleados')
        .insert({
          negocio_id: negocioId,
          empleado_id: beneficiarioId,
          tipo_movimiento: tipo,
          monto,
          descripcion,
          creado_por: creadoPor
        })
        .select('id'),
      tipo === 'AJUSTE_CARGO' ? 'Cargo registrado' : 'Abono registrado'
    );
    // result es null en error, array vacío o con filas en éxito
    return result !== null && result.length > 0;
  }

  /**
   * Preview de nomina — solo lectura, calcula en TypeScript.
   * Recibe proporcionalInfo ya calculado para no duplicar la lógica.
   * Llama en paralelo a las 2 queries independientes (descuentos + saldos de cajas).
   */
  async calcularPreviewNomina(
    beneficiarioId: string,
    sueldoBase: number,
    proporcionalInfo: ProporcionalInfo | null
  ): Promise<PreviewNomina> {
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

    const descuentos: DetalleDescuento[] = pendientes.map(m => ({
      tipo: m.tipo_movimiento,
      monto: m.monto,
      fecha: m.fecha,
      descripcion: m.descripcion ?? ''
    }));

    const totalDescuentos = descuentos.reduce((sum, d) => sum + d.monto, 0);
    const liquido = sueldoBase - totalDescuentos;

    const saldoVarios = cajas.find(c => c.codigo === 'VARIOS')?.saldo_actual ?? 0;
    const saldoCaja = cajas.find(c => c.codigo === 'CAJA')?.saldo_actual ?? 0;

    const arrastre = liquido < 0 ? -liquido : 0;
    const montoDeVarios = liquido > 0 ? Math.min(liquido, saldoVarios) : 0;
    const montoDeCaja = liquido > 0 ? liquido - montoDeVarios : 0;
    const fondosSuficientes = liquido <= 0 || montoDeCaja <= saldoCaja;

    return {
      sueldoBase,
      descuentos,
      totalDescuentos,
      liquido,
      arrastre,
      saldoVarios,
      saldoCaja,
      montoDeVarios,
      montoDeCaja,
      fondosSuficientes,
      proporcional: proporcionalInfo ?? undefined
    };
  }

  /**
   * Calcula el sueldo proporcional para el período actual del empleado.
   *
   * Casos:
   * 1. Empleado transferido (activo=FALSE): período = created_at → updated_at (fecha transferencia)
   * 2. Empleado activo con < 30 días en el negocio: período = created_at → hoy
   * 3. Empleado activo con >= 30 días Y tiene PAGO_NOMINA previo hace < 30 días: período desde el último pago
   * 4. Empleado activo con >= 30 días sin pagos recientes: sueldo completo (null = sin sugerencia proporcional)
   *
   * Fix multi-tenant: filtra por negocio_id del JWT via RLS (la query ya está filtrada
   * porque el JWT tiene negocio_id activo y la RLS de usuario_negocios lo aplica).
   * Se agrega eq('negocio_id') explícito para evitar ambigüedad con la OR clause de RLS.
   */
  async obtenerProporcional(beneficiarioId: string, sueldoBase: number): Promise<ProporcionalInfo | null> {
    if (sueldoBase <= 0) return null;

    const msPerDay = 1000 * 60 * 60 * 24;
    const hoy = new Date();

    // Leer membresía del negocio activo — negocio_id explícito para evitar bug OR clause RLS
    const membresia = await this.supabase.call<{ activo: boolean; created_at: string; updated_at: string } | null>(
      this.supabase.client
        .from('usuario_negocios')
        .select('activo, created_at, updated_at')
        .eq('usuario_id', beneficiarioId)
        .eq('negocio_id', this.auth.usuarioActualValue?.negocio_id)
        .maybeSingle()
    ) ?? null;

    if (!membresia) return null;

    let fechaDesde: Date;
    let fechaHasta: Date;

    let esTransferido = false;
    let tienePagosPrevios = false;

    if (!membresia.activo) {
      esTransferido = true;
      fechaDesde = new Date(membresia.created_at);
      fechaHasta = new Date(membresia.updated_at);
    } else {
      const ultimoPago = await this.supabase.call<{ fecha: string } | null>(
        this.supabase.client
          .from('movimientos_empleados')
          .select('fecha')
          .eq('empleado_id', beneficiarioId)
          .eq('tipo_movimiento', 'PAGO_NOMINA')
          .order('fecha', { ascending: false })
          .limit(1)
          .maybeSingle()
      ) ?? null;

      if (ultimoPago) {
        tienePagosPrevios = true;
        fechaDesde = new Date(ultimoPago.fecha);
      } else {
        fechaDesde = new Date(membresia.created_at);
      }

      fechaHasta = hoy;

      const diasDesdeInicio = Math.round((hoy.getTime() - fechaDesde.getTime()) / msPerDay);
      if (diasDesdeInicio >= 30) return null;
    }

    const diasTrabajados = Math.max(1, Math.round((fechaHasta.getTime() - fechaDesde.getTime()) / msPerDay));
    const sueldoSugerido = Math.round((sueldoBase / 30) * diasTrabajados * 100) / 100;

    return {
      diasTrabajados,
      fechaDesde: fechaDesde.toISOString(),
      fechaHasta: fechaHasta.toISOString(),
      sueldoSugerido,
      esTransferido,
      tienePagosPrevios
    };
  }

  // ── RPCs atomicas ──

  /** Registrar adelanto de sueldo (atomico: cajas + movimiento). No requiere turno abierto. */
  async registrarAdelanto(params: {
    empleadoId: string;
    beneficiarioId: string;
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
    empleadoId: string;
    beneficiarioId: string;
    sueldoBase: number;
    periodoInicio?: string;  // ISO date YYYY-MM-DD — para trazabilidad en SUELDO_BASE
    periodoFin?: string;     // ISO date YYYY-MM-DD
    descripcion?: string;
    comprobanteUrl?: string;
  }): Promise<ResultadoPagoNomina> {
    const result = await this.supabase.call<ResultadoPagoNomina>(
      this.supabase.client.rpc('fn_pagar_nomina_empleado', {
        p_empleado_id: params.empleadoId,
        p_beneficiario_id: params.beneficiarioId,
        p_sueldo_base: params.sueldoBase,
        p_periodo_inicio: params.periodoInicio ?? null,
        p_periodo_fin: params.periodoFin ?? null,
        p_descripcion: params.descripcion ?? null,
        p_comprobante_url: params.comprobanteUrl ?? null
      })
    );
    return result ?? { success: false, error: 'Error de conexion' };
  }
}
