import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { AuthService } from '../../auth/services/auth.service';
import { getFechaLocal, getInicioDiaSiguienteISO } from '@core/utils/date.util';

/**
 * Interfaz para la tabla cajas
 */
export interface Caja {
  id: string;
  codigo: string;
  nombre: string;
  saldo_actual: number;
  activo: boolean;
  icono?: string;
  color?: string;
  descripcion?: string;
  created_at?: string;
}

/**
 * Respuesta con los saldos de todas las cajas (v5: 5 cajas)
 */
export interface SaldosCajas {
  cajaPrincipal: number; // CAJA — bóveda/depósito principal
  cajaChica: number;     // CAJA_CHICA — cajón físico diario (v5: nuevo)
  varios: number;        // VARIOS — fondo de emergencia (v5: antes era CAJA_CHICA)
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
  private auth     = inject(AuthService);

  /**
   * Obtiene todas las cajas activas ordenadas por ID
   * Usa supabase.call() → overlay automático. Para mutaciones o páginas sin spinner propio.
   */
  async obtenerCajas(): Promise<Caja[] | null> {
    const cajas = await this.supabase.call<Caja[]>(
      this.supabase.client
        .from('cajas')
        .select('id, codigo, nombre, saldo_actual, activo, icono, color, descripcion')
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
      .select('id, codigo, nombre, saldo_actual, activo, icono, color, descripcion')
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
    const varios = cajas.find(c => c.codigo === 'VARIOS')?.saldo_actual ?? 0;
    const cajaCelular = cajas.find(c => c.codigo === 'CAJA_CELULAR')?.saldo_actual ?? 0;
    const cajaBus = cajas.find(c => c.codigo === 'CAJA_BUS')?.saldo_actual ?? 0;
    const totalCustom = cajas
      .filter(c => c.codigo.startsWith('CUSTOM_'))
      .reduce((sum, c) => sum + c.saldo_actual, 0);
    const total = cajaPrincipal + cajaChica + varios + cajaCelular + cajaBus + totalCustom;

    return {
      cajaPrincipal,
      cajaChica,
      varios,
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
   * Obtiene una caja por su nombre display (ej: 'Tienda', 'Varios', 'Celular', 'Bus')
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
  async obtenerCajaPorId(id: string): Promise<Caja | null> {
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
   * Obtiene la fecha del último cierre registrado (v5)
   * Consulta turnos_caja buscando el turno más reciente que ya fue cerrado (hora_fecha_cierre IS NOT NULL)
   * @returns Fecha en formato YYYY-MM-DD (fecha local) o null si no hay cierres
   */
  async obtenerFechaUltimoCierre(): Promise<string | null> {
    const turno = await this.supabase.call<{ hora_fecha_cierre: string }>(
      this.supabase.client
        .from('turnos_caja')
        .select('hora_fecha_cierre')
        .not('hora_fecha_cierre', 'is', null)
        .order('hora_fecha_cierre', { ascending: false })
        .limit(1)
        .maybeSingle()
    );

    if (!turno?.hora_fecha_cierre) return null;

    // Convertir TIMESTAMPTZ a fecha local (YYYY-MM-DD)
    const fechaCierre = new Date(turno.hora_fecha_cierre);
    const año = fechaCierre.getFullYear();
    const mes = String(fechaCierre.getMonth() + 1).padStart(2, '0');
    const dia = String(fechaCierre.getDate()).padStart(2, '0');
    return `${año}-${mes}-${dia}`;
  }

  /**
   * Verifica si la caja está abierta o cerrada (v5)
   * En v5 el cierre cierra el turno (hora_fecha_cierre IS NOT NULL).
   * Consulta turnos_caja buscando un turno activo hoy (sin hora_fecha_cierre).
   * @returns true si está abierta (hay turno sin cierre hoy), false si no hay turno activo
   */
  async verificarEstadoCaja(): Promise<boolean> {
    const inicioDia = new Date(`${getFechaLocal()}T00:00:00`).toISOString();
    const inicioMana = getInicioDiaSiguienteISO();

    const turno = await this.supabase.call<{ id: string }>(
      this.supabase.client
        .from('turnos_caja')
        .select('id')
        .gte('hora_fecha_apertura', inicioDia)
        .lt('hora_fecha_apertura', inicioMana)
        .is('hora_fecha_cierre', null)
        .maybeSingle()
    );

    // Hay turno activo → ABIERTA
    return turno !== null;
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
  async crearCaja(nombre: string, icono: string, color: string, descripcion: string, saldoInicial: number): Promise<Caja | null> {
    const negocioId = this.auth.usuarioActualValue?.negocio_id;
    if (!negocioId) return null;

    // Genera código único CUSTOM_N basado en las cajas custom existentes
    const { data: existentes } = await this.supabase.client
      .from('cajas')
      .select('codigo')
      .like('codigo', 'CUSTOM_%');

    const n = (existentes?.length ?? 0) + 1;
    const codigo = `CUSTOM_${n}`;

    return this.supabase.call<Caja>(
      this.supabase.client
        .from('cajas')
        .insert({ negocio_id: negocioId, codigo, nombre, icono, color, descripcion: descripcion || null, saldo_actual: saldoInicial })
        .select('id, codigo, nombre, saldo_actual, activo, icono, color, descripcion')
        .single(),
      'Caja creada correctamente'
    );
  }

  async crearTransferencia(params: {
    codigoOrigen: string;
    codigoDestino: string;
    monto: number;
    empleadoId: string;
    descripcion: string;
  }): Promise<void> {
    const { codigoOrigen, codigoDestino, monto, empleadoId, descripcion } = params;

    const response = await this.supabase.call(
      this.supabase.client.rpc('fn_crear_transferencia', {
        p_codigo_origen: codigoOrigen,
        p_codigo_destino: codigoDestino,
        p_monto: monto,
        p_empleado_id: empleadoId,
        p_descripcion: descripcion
      }),
      undefined,
      { showLoading: true }
    );

    if (response === null) {
      throw new Error('Error de conexión al crear transferencia');
    }

    const data = response as any;

    if (!data?.success) {
      throw new Error(data?.error || 'Error desconocido al crear transferencia');
    }
  }
}
