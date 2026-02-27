import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { getFechaLocal } from '@core/utils/date.util';

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
   * Usa supabase.call() → overlay automático. Para mutaciones o páginas sin spinner propio.
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
   * Obtiene todas las cajas activas SIN overlay (Patrón B).
   * Usar en páginas de lista que ya tienen su propio spinner local.
   */
  async obtenerCajasDirecto(): Promise<Caja[]> {
    const { data, error } = await this.supabase.client
      .from('cajas')
      .select('id, codigo, nombre, saldo_actual, activo')
      .eq('activo', true)
      .order('id');
    if (error) return [];
    return data ?? [];
  }

  /**
   * Obtiene los saldos de todas las cajas con el total calculado
   */
  async obtenerSaldosCajas(): Promise<SaldosCajas | null> {
    const cajas = await this.obtenerCajas();

    if (!cajas) {
      return null;
    }

    const cajaPrincipal = cajas.find(c => c.codigo === 'CAJA')?.saldo_actual ?? 0;
    const cajaChica = cajas.find(c => c.codigo === 'CAJA_CHICA')?.saldo_actual ?? 0;
    const cajaCelular = cajas.find(c => c.codigo === 'CAJA_CELULAR')?.saldo_actual ?? 0;
    const cajaBus = cajas.find(c => c.codigo === 'CAJA_BUS')?.saldo_actual ?? 0;
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
    const fechaHoy = getFechaLocal();

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
   * Crea una transferencia atómica entre dos cajas usando sus códigos.
   * Delega en la función PostgreSQL `crear_transferencia` que garantiza
   * atomicidad (todo o nada) y validación de saldo antes de operar.
   *
   * @param params.codigoOrigen  - Código de la caja origen (ej: 'CAJA_BUS')
   * @param params.codigoDestino - Código de la caja destino (ej: 'CAJA_CHICA')
   * @param params.monto         - Monto a transferir
   * @param params.empleadoId    - ID del empleado que realiza la transferencia
   * @param params.descripcion   - Descripción de la transferencia
   * @throws Error si la función PostgreSQL devuelve success=false
   */
  async crearTransferencia(params: {
    codigoOrigen: string;
    codigoDestino: string;
    monto: number;
    empleadoId: number;
    descripcion: string;
  }): Promise<void> {
    const { codigoOrigen, codigoDestino, monto, empleadoId, descripcion } = params;

    const { data, error } = await this.supabase.client.rpc('crear_transferencia', {
      p_codigo_origen:  codigoOrigen,
      p_codigo_destino: codigoDestino,
      p_monto:          monto,
      p_empleado_id:    empleadoId,
      p_descripcion:    descripcion
    });

    if (error) {
      throw new Error(error.message || 'Error de conexión al crear transferencia');
    }

    if (!data?.success) {
      throw new Error(data?.error || 'Error desconocido al crear transferencia');
    }
  }
}
