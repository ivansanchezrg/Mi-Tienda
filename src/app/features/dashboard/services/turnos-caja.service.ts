import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { UiService } from '@core/services/ui.service';
import { AuthService } from '../../auth/services/auth.service';
import { TurnoCajaConEmpleado, EstadoCaja, EstadoCajaTipo } from '../models/turno-caja.model';
import { getFechaLocal } from '@core/utils/date.util';

@Injectable({
  providedIn: 'root'
})
export class TurnosCajaService {
  private supabase = inject(SupabaseService);
  private authService = inject(AuthService);
  private ui = inject(UiService);

  /**
   * Obtiene el fondo fijo diario desde configuraciones
   */
  async obtenerFondoFijo(): Promise<number> {
    const config = await this.supabase.client
      .from('configuraciones')
      .select('fondo_fijo_diario')
      .single();

    return config.data?.fondo_fijo_diario ?? 40.00;
  }

  /**
   * Obtiene el turno activo (abierto) de hoy, si existe
   */
  async obtenerTurnoActivo(): Promise<TurnoCajaConEmpleado | null> {
    const fechaHoy = getFechaLocal();

    const turno = await this.supabase.call<TurnoCajaConEmpleado>(
      this.supabase.client
        .from('turnos_caja')
        .select('*, empleado:empleados(id, nombre)')
        .eq('fecha', fechaHoy)
        .is('hora_cierre', null)
        .maybeSingle()
    );

    return turno;
  }

  /**
   * Abre un nuevo turno de caja.
   * Valida que no haya un turno abierto antes de crear uno nuevo.
   */
  async abrirTurno(): Promise<boolean> {
    const fechaHoy = getFechaLocal();

    // Validar: no debe haber turno abierto
    const { data: turnoAbierto } = await this.supabase.client
      .from('turnos_caja')
      .select('id')
      .eq('fecha', fechaHoy)
      .is('hora_cierre', null)
      .maybeSingle();

    if (turnoAbierto) {
      return false; // Ya hay turno abierto
    }

    // Obtener empleado actual
    const empleado = await this.authService.getEmpleadoActual();
    if (!empleado) {
      return false;
    }

    // Calcular número de turno (siguiente al último del día)
    const { count } = await this.supabase.client
      .from('turnos_caja')
      .select('id', { count: 'exact', head: true })
      .eq('fecha', fechaHoy);

    const numeroTurno = (count ?? 0) + 1;

    // Insertar turno
    const { error } = await this.supabase.client
      .from('turnos_caja')
      .insert({
        fecha: fechaHoy,
        numero_turno: numeroTurno,
        empleado_id: empleado.id,
        hora_apertura: new Date().toISOString() // TIMESTAMPTZ: UTC correcto
      });

    if (error) {
      await this.ui.showError(error.message || 'Error al abrir el turno');
      return false;
    }

    await this.ui.showSuccess('Caja abierta');
    return true;
  }

  /**
   * Cierra el turno activo
   */
  async cerrarTurno(turnoId: string): Promise<boolean> {
    const { error } = await this.supabase.client
      .from('turnos_caja')
      .update({ hora_cierre: new Date().toISOString() }) // TIMESTAMPTZ: UTC correcto
      .eq('id', turnoId);

    if (error) {
      await this.ui.showError(error.message || 'Error al cerrar el turno');
      return false;
    }

    await this.ui.showSuccess('Caja cerrada');
    return true;
  }

  /**
   * Obtiene el déficit del último cierre registrado.
   * Si el turno anterior cerró con déficit, el siguiente turno debe reponer:
   *  - deficit_caja_chica: lo que faltó transferir a Caja Chica
   *  - fondoFaltante: lo que faltó dejar en caja física (calculado desde config)
   *
   * Retorna null si no hay cierre previo o si el cierre fue normal (sin déficit).
   */
  async obtenerDeficitTurnoAnterior(): Promise<{ deficitCajaChica: number; fondoFaltante: number; efectivoRecaudado: number } | null> {
    const { data, error } = await this.supabase.client
      .from('caja_fisica_diaria')
      .select('efectivo_recaudado, deficit_caja_chica')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    const deficitCajaChica = data.deficit_caja_chica ?? 0;

    if (deficitCajaChica <= 0) return null;

    const fondoFijo = await this.obtenerFondoFijo();
    const efectivoRecaudado = data.efectivo_recaudado ?? 0;
    const fondoFaltante = Math.max(0, fondoFijo - efectivoRecaudado);

    return { deficitCajaChica, fondoFaltante, efectivoRecaudado };
  }

  /**
   * Registra las operaciones contables para reparar el déficit del turno anterior.
   * Usa la función dedicada `reparar_deficit_turno` que NO valida saldo mínimo en Tienda.
   *
   * Retorna { ok: true } si todo OK, o { ok: false, errorMsg } con el mensaje del RPC.
   */
  async repararDeficit(deficitCajaChica: number, fondoFaltante: number): Promise<{ ok: boolean; errorMsg?: string }> {
    const empleado = await this.authService.getEmpleadoActual();
    if (!empleado) return { ok: false, errorMsg: 'No se pudo obtener el empleado actual' };

    const { data: categorias, error: catError } = await this.supabase.client
      .from('categorias_operaciones')
      .select('id, codigo')
      .in('codigo', ['EG-012', 'IN-004']);

    if (catError || !categorias || categorias.length < 2) {
      return { ok: false, errorMsg: 'No se encontraron las categorías de ajuste (EG-012 / IN-004). Ejecuta la migración SQL.' };
    }

    const catEgreso = categorias.find(c => c.codigo === 'EG-012');
    const catIngreso = categorias.find(c => c.codigo === 'IN-004');

    if (!catEgreso || !catIngreso) {
      return { ok: false, errorMsg: 'Categorías de ajuste incompletas en la base de datos.' };
    }

    const { data, error } = await this.supabase.client
      .rpc('reparar_deficit_turno', {
        p_empleado_id:        empleado.id,
        p_deficit_caja_chica: deficitCajaChica,
        p_fondo_faltante:     fondoFaltante,
        p_cat_egreso_id:      catEgreso.id,
        p_cat_ingreso_id:     catIngreso.id
      });

    if (error) {
      return { ok: false, errorMsg: error.message || 'Error de conexión con el servidor' };
    }

    if (!data?.success) {
      return { ok: false, errorMsg: data?.error || 'Error desconocido al registrar el ajuste' };
    }

    return { ok: true };
  }

  /**
   * Obtiene el estado completo de la caja para mostrar en el banner
   */
  async obtenerEstadoCaja(): Promise<EstadoCaja> {
    const fechaHoy = getFechaLocal();

    const turnoActivo = await this.supabase.call<TurnoCajaConEmpleado>(
      this.supabase.client
        .from('turnos_caja')
        .select('*, empleado:empleados(id, nombre)')
        .eq('fecha', fechaHoy)
        .is('hora_cierre', null)
        .maybeSingle()
    );

    const { count } = await this.supabase.client
      .from('turnos_caja')
      .select('id', { count: 'exact', head: true })
      .eq('fecha', fechaHoy);

    const turnosHoy = count ?? 0;

    let estado: EstadoCajaTipo;
    let empleadoNombre = '';
    let horaApertura = '';

    if (turnoActivo) {
      estado = 'TURNO_EN_CURSO';
      empleadoNombre = turnoActivo.empleado?.nombre || '';
      horaApertura = new Date(turnoActivo.hora_apertura).toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } else if (turnosHoy > 0) {
      estado = 'CERRADA';
    } else {
      estado = 'SIN_ABRIR';
    }

    return {
      estado,
      turnoActivo,
      empleadoNombre,
      horaApertura,
      turnosHoy
    };
  }
}
