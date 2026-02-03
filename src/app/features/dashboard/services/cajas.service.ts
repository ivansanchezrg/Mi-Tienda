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
   * Consulta la tabla cierres_diarios ordenada por fecha descendente
   * @returns Fecha en formato YYYY-MM-DD o null si no hay cierres
   */
  async obtenerFechaUltimoCierre(): Promise<string | null> {
    const cierre = await this.supabase.call<{ fecha: string }>(
      this.supabase.client
        .from('cierres_diarios')
        .select('fecha')
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle()
    );

    return cierre?.fecha || null;
  }

  /**
   * Verifica si la caja está abierta o cerrada
   * Consulta la última operación APERTURA/CIERRE del día actual
   * @returns true si está abierta, false si está cerrada
   */
  async verificarEstadoCaja(): Promise<boolean> {
    const operacion = await this.supabase.call<{ tipo_operacion: string }>(
      this.supabase.client
        .from('operaciones_cajas')
        .select('tipo_operacion')
        .eq('caja_id', 1) // CAJA_PRINCIPAL como representativa del turno
        .gte('fecha', new Date().toISOString().split('T')[0]) // Desde hoy a las 00:00
        .in('tipo_operacion', ['APERTURA', 'CIERRE'])
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle()
    );

    return operacion?.tipo_operacion === 'APERTURA';
  }

  /**
   * Abre la caja (inicia el turno de trabajo)
   * Crea una operación APERTURA en CAJA_PRINCIPAL
   * @param empleadoId ID del empleado que abre la caja
   */
  async abrirCaja(empleadoId: number): Promise<void> {
    await this.supabase.call(
      this.supabase.client
        .from('operaciones_cajas')
        .insert({
          caja_id: 1, // CAJA_PRINCIPAL
          empleado_id: empleadoId,
          tipo_operacion: 'APERTURA',
          monto: 0,
          descripcion: 'Apertura de turno'
        })
    );
  }

  /**
   * Obtiene la hora de apertura de la caja del día actual
   * @returns Hora en formato "7:00 AM" o null si no hay apertura
   */
  async obtenerHoraApertura(): Promise<string | null> {
    const operacion = await this.supabase.call<{ fecha: string }>(
      this.supabase.client
        .from('operaciones_cajas')
        .select('fecha')
        .eq('caja_id', 1) // CAJA_PRINCIPAL
        .eq('tipo_operacion', 'APERTURA')
        .gte('fecha', new Date().toISOString().split('T')[0]) // Desde hoy a las 00:00
        .order('fecha', { ascending: false })
        .limit(1)
        .maybeSingle()
    );

    if (!operacion?.fecha) return null;

    // Formatear hora a "7:00 AM"
    const fecha = new Date(operacion.fecha);
    const horas = fecha.getHours();
    const minutos = fecha.getMinutes();
    const ampm = horas >= 12 ? 'PM' : 'AM';
    const horas12 = horas % 12 || 12;
    const minutosStr = minutos.toString().padStart(2, '0');

    return `${horas12}:${minutosStr} ${ampm}`;
  }
}
