import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';

/**
 * Interfaz para la tabla cajas
 */
export interface Caja {
  id: number;
  codigo: string;
  nombre: string;
  saldo_actual: number;
  activo: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Respuesta con los saldos de todas las cajas
 */
export interface SaldosCajas {
  cajaPrincipal: number;
  cajaChica: number;
  cajaCelular: number;
  cajaBus: number;
  total: number;
  cajas: Caja[];
}

/**
 * Servicio para gestionar operaciones de cajas
 */
@Injectable({
  providedIn: 'root'
})
export class CajasService {
  private supabase = inject(SupabaseService);

  /**
   * Obtiene todas las cajas activas ordenadas por ID
   */
  async obtenerCajas(): Promise<Caja[] | null> {
    const cajas = await this.supabase.call<Caja[]>(
      this.supabase.client
        .from('cajas')
        .select('id, codigo, nombre, saldo_actual, activo')
        .eq('activo', true)
        .order('id')
    );
    return cajas;
  }

  /**
   * Obtiene los saldos de todas las cajas con el total calculado
   */
  async obtenerSaldosCajas(): Promise<SaldosCajas | null> {
    const cajas = await this.obtenerCajas();

    if (!cajas) {
      return null;
    }

    const cajaPrincipal = cajas.find(c => c.codigo === 'CAJA')?.saldo_actual || 0;
    const cajaChica = cajas.find(c => c.codigo === 'CAJA_CHICA')?.saldo_actual || 0;
    const cajaCelular = cajas.find(c => c.codigo === 'CAJA_CELULAR')?.saldo_actual || 0;
    const cajaBus = cajas.find(c => c.codigo === 'CAJA_BUS')?.saldo_actual || 0;
    const total = cajaPrincipal + cajaChica + cajaCelular + cajaBus;

    return {
      cajaPrincipal,
      cajaChica,
      cajaCelular,
      cajaBus,
      total,
      cajas
    };
  }

  /**
   * Obtiene el saldo de una caja específica por código
   */
  async obtenerSaldoCaja(codigoCaja: string): Promise<number | null> {
    const caja = await this.supabase.call<Caja>(
      this.supabase.client
        .from('cajas')
        .select('saldo_actual')
        .eq('codigo', codigoCaja)
        .eq('activo', true)
        .single()
    );

    return caja ? caja.saldo_actual : null;
  }

  /**
   * Obtiene una caja por su código (ej: 'CAJA', 'CAJA_CHICA')
   */
  async obtenerCajaPorCodigo(codigoCaja: string): Promise<Caja | null> {
    const caja = await this.supabase.call<Caja>(
      this.supabase.client
        .from('cajas')
        .select('*')
        .eq('codigo', codigoCaja)
        .eq('activo', true)
        .single()
    );

    return caja;
  }

  /**
   * Obtiene una caja por su nombre display (ej: 'Caja Principal')
   */
  async obtenerCajaPorNombre(nombreCaja: string): Promise<Caja | null> {
    const caja = await this.supabase.call<Caja>(
      this.supabase.client
        .from('cajas')
        .select('*')
        .eq('nombre', nombreCaja)
        .eq('activo', true)
        .single()
    );

    return caja;
  }

  /**
   * Obtiene una caja por su ID
   */
  async obtenerCajaPorId(id: number): Promise<Caja | null> {
    const caja = await this.supabase.call<Caja>(
      this.supabase.client
        .from('cajas')
        .select('*')
        .eq('id', id)
        .single()
    );

    return caja;
  }

  /**
   * Obtiene la fecha del último cierre registrado
   * Consulta la tabla caja_fisica_diaria ordenada por fecha descendente
   * @returns Fecha en formato YYYY-MM-DD o null si no hay cierres
   */
  async obtenerFechaUltimoCierre(): Promise<string | null> {
    const cierre = await this.supabase.call<{ fecha: string }>(
      this.supabase.client
        .from('caja_fisica_diaria')
        .select('fecha')
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle()
    );

    return cierre?.fecha || null;
  }

  /**
   * Verifica si la caja está abierta o cerrada (Versión 3.0)
   * Consulta la tabla caja_fisica_diaria
   * @returns true si está abierta (NO hay cierre para hoy), false si está cerrada (SÍ hay cierre)
   */
  async verificarEstadoCaja(): Promise<boolean> {
    const fechaHoy = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const cierre = await this.supabase.call<{ id: string }>(
      this.supabase.client
        .from('caja_fisica_diaria')
        .select('id')
        .eq('fecha', fechaHoy)
        .maybeSingle()
    );

    // Si NO existe cierre para hoy → está ABIERTA
    // Si SÍ existe cierre para hoy → está CERRADA
    return cierre === null;
  }

  /**
   * DEPRECADO en Versión 3.0
   * La apertura ahora se representa implícitamente en caja_fisica_diaria
   * Ya NO se crea operación APERTURA
   *
   * @deprecated Ya no se usa - la apertura se maneja en el cierre diario
   */
  async abrirCaja(empleadoId: number): Promise<void> {
    // Método deprecado - ya no hace nada
    // La apertura se representa por la ausencia de cierre para el día actual
    console.warn('abrirCaja() está deprecado en v3.0 - la apertura se maneja en caja_fisica_diaria');
  }

  /**
   * Obtiene la hora de "apertura" del día actual (Versión 2.0)
   * En v2.0, la apertura es implícita (cuando NO existe cierre para hoy)
   * Este método devuelve null ya que no hay operación APERTURA específica
   * @returns null - La apertura ya no tiene hora específica en v2.0
   * @deprecated Ya no tiene sentido en v2.0 - considerar eliminar del UI
   */
  async obtenerHoraApertura(): Promise<string | null> {
    // En v2.0, la apertura es implícita (ausencia de cierre)
    // No hay hora de apertura específica
    return null;
  }

  /**
   * Registra una operación de ingreso o egreso en una caja
   * @param params Parámetros de la operación
   */
  async registrarOperacion(params: {
    cajaId: number;
    empleadoId: number;
    tipo: 'INGRESO' | 'EGRESO';
    monto: number;
    descripcion: string;
  }): Promise<void> {
    const { cajaId, empleadoId, tipo, monto, descripcion } = params;

    // 1. Obtener caja y saldo actual
    const caja = await this.obtenerCajaPorId(cajaId);
    if (!caja) {
      throw new Error('Caja no encontrada');
    }

    // 2. Validar saldo suficiente para egreso
    if (tipo === 'EGRESO' && monto > caja.saldo_actual) {
      throw new Error('Saldo insuficiente para realizar el egreso');
    }

    // 3. Calcular nuevo saldo
    const nuevoSaldo = tipo === 'INGRESO'
      ? caja.saldo_actual + monto
      : caja.saldo_actual - monto;

    // 4. Insertar operación
    await this.supabase.call(
      this.supabase.client
        .from('operaciones_cajas')
        .insert({
          caja_id: cajaId,
          empleado_id: empleadoId,
          tipo_operacion: tipo,
          monto: monto,
          saldo_anterior: caja.saldo_actual,
          saldo_actual: nuevoSaldo,
          descripcion: descripcion || (tipo === 'INGRESO' ? 'Ingreso manual' : 'Egreso manual')
        })
    );

    // 5. Actualizar saldo en tabla cajas
    await this.supabase.call(
      this.supabase.client
        .from('cajas')
        .update({ saldo_actual: nuevoSaldo })
        .eq('id', cajaId)
    );
  }

  /**
   * Crea una transferencia entre dos cajas
   * Genera dos operaciones: TRANSFERENCIA_SALIENTE y TRANSFERENCIA_ENTRANTE
   * @param params Parámetros de la transferencia
   */
  async crearTransferencia(params: {
    cajaOrigenId: number;
    cajaDestinoId: number;
    monto: number;
    empleadoId: number;
    descripcion: string;
  }): Promise<void> {
    const { cajaOrigenId, cajaDestinoId, monto, empleadoId, descripcion } = params;

    // 1. Obtener saldos actuales
    const cajaOrigen = await this.obtenerCajaPorId(cajaOrigenId);
    const cajaDestino = await this.obtenerCajaPorId(cajaDestinoId);

    if (!cajaOrigen || !cajaDestino) {
      throw new Error('Caja no encontrada');
    }

    // 2. Calcular nuevos saldos
    const nuevoSaldoOrigen = cajaOrigen.saldo_actual - monto;
    const nuevoSaldoDestino = cajaDestino.saldo_actual + monto;

    // 3. Crear operación SALIENTE en caja origen
    await this.supabase.call(
      this.supabase.client
        .from('operaciones_cajas')
        .insert({
          caja_id: cajaOrigenId,
          empleado_id: empleadoId,
          tipo_operacion: 'TRANSFERENCIA_SALIENTE',
          monto: monto,
          saldo_anterior: cajaOrigen.saldo_actual,
          saldo_actual: nuevoSaldoOrigen,
          descripcion: descripcion
        })
    );

    // 4. Crear operación ENTRANTE en caja destino
    await this.supabase.call(
      this.supabase.client
        .from('operaciones_cajas')
        .insert({
          caja_id: cajaDestinoId,
          empleado_id: empleadoId,
          tipo_operacion: 'TRANSFERENCIA_ENTRANTE',
          monto: monto,
          saldo_anterior: cajaDestino.saldo_actual,
          saldo_actual: nuevoSaldoDestino,
          descripcion: `${descripcion} desde ${cajaOrigen.nombre}`
        })
    );

    // 5. Actualizar saldos en tabla cajas
    await Promise.all([
      this.supabase.call(
        this.supabase.client
          .from('cajas')
          .update({ saldo_actual: nuevoSaldoOrigen })
          .eq('id', cajaOrigenId)
      ),
      this.supabase.call(
        this.supabase.client
          .from('cajas')
          .update({ saldo_actual: nuevoSaldoDestino })
          .eq('id', cajaDestinoId)
      )
    ]);
  }
}
