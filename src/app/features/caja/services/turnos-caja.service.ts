import { Injectable, inject, NgZone } from '@angular/core';
import { BehaviorSubject, map, distinctUntilChanged, combineLatest, filter, firstValueFrom } from 'rxjs';
import { Preferences } from '@capacitor/preferences';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '@core/services/supabase.service';
import { UiService } from '@core/services/ui.service';
import { LoggerService } from '@core/services/logger.service';
import { ConfigService } from '@core/services/config.service';
import { TurnoLocalService } from '@core/services/turno-local.service';
import { NetworkService } from '@core/services/network.service';
import { AuthService } from '../../auth/services/auth.service';
import { TurnoCaja, TurnoCajaConEmpleado, EstadoCaja, EstadoCajaTipo } from '../models/turno-caja.model';
import { Caja } from './cajas.service';
import { DatosCierreDiario } from '../models/saldos-anteriores.model';
import { getFechaLocal, getInicioDiaSiguienteISO, getInicioDiaSiguienteDeISO } from '@core/utils/date.util';

/**
 * Snapshot consolidado del dashboard del home (devuelto por la RPC fn_home_dashboard).
 * Reemplaza las múltiples llamadas paralelas que hacía home.cargarDatos().
 * v1.3: incluye cajas[] para que cargarDatos() sea la única fuente de verdad del Home.
 * v1.4: incluye modulos con flags de visibilidad con fuente de verdad correcta por caja:
 *   - variosActiva:        cajas.activo en BD (reversible via fn_configurar_caja_varios)
 *   - celularHabilitada:   flag en configuraciones (puede existir en BD pero desactivada)
 *   - busHabilitada:       flag en configuraciones (igual que celular)
 * v2.0 (2026-07-03): se eliminó la sección "últimos 5 movimientos" del home. La RPC
 *   ya no devuelve la lista ni el count — solo los agregados ingresos/egresos del día
 *   completo, que alimentan los deltas del hero (antes se calculaban sumando únicamente
 *   los últimos 5 movimientos: ahora son correctos además de más baratos).
 */
export interface HomeDashboard {
  estadoCaja: EstadoCaja;
  saldoVirtualCelular: number;
  saldoVirtualBus: number;
  ingresosHoy: number;
  egresosHoy: number;
  cajas: Caja[];
  modulos: {
    variosActiva: boolean;
    celularHabilitada: boolean;
    busHabilitada: boolean;
  };
}

/**
 * Snapshot del dashboard persistido en Preferences — habilita el arranque instantáneo
 * del home (stale-while-revalidate). Válido solo el mismo día local y el mismo negocio:
 * los turnos son diarios, pintar un "turno abierto" de ayer confunde más de lo que ayuda.
 */
interface HomeDashboardSnapshot {
  negocio_id: string | null;
  fecha: string;            // 'YYYY-MM-DD' local (getFechaLocal)
  data: HomeDashboard;
}

@Injectable({
  providedIn: 'root'
})
export class TurnosCajaService {
  private supabase = inject(SupabaseService);
  private authService = inject(AuthService);
  private ui = inject(UiService);
  private logger = inject(LoggerService);
  private configService = inject(ConfigService);
  private zone = inject(NgZone);
  private turnoLocal = inject(TurnoLocalService);
  private network = inject(NetworkService);

  // ==========================================
  // ESTADO REACTIVO — turno activo + caja abierta
  // ==========================================

  /**
   * Turno actualmente abierto (hora_fecha_cierre IS NULL), o null si no hay.
   * Fuente unica de verdad del estado del turno — todos los consumidores
   * (POS, Cajon, Sidebar, HomePage, layout) se suscriben aqui.
   *
   * Se carga una vez tras validarUsuario() exitoso (desde AuthService) y se
   * mantiene sincronizado via Realtime de la tabla turnos_caja.
   */
  private readonly _turnoActivo$ = new BehaviorSubject<TurnoCajaConEmpleado | null>(null);
  readonly turnoActivo$ = this._turnoActivo$.asObservable();

  /**
   * Derivado: true si el turno activo fue abierto por el usuario actual.
   * Solo el empleado que abrió el turno puede operar el Cajón y el POS.
   * Los demás usuarios pueden ver el estado pero no registrar en esas secciones.
   */
  readonly esMiTurno$ = combineLatest([
    this._turnoActivo$,
    this.authService.usuarioActual$
  ]).pipe(
    map(([turno, usuario]) => turno !== null && !!usuario && turno.empleado_id === usuario.id),
    distinctUntilChanged()
  );

  /**
   * Emite true una vez que inicializarEstadoReactivo() termino su query a BD.
   * El guard cajaAbiertaGuard espera este flag antes de decidir — evita la
   * race condition al hacer refresh (el estado reactivo aun no cargo).
   */
  private readonly _inicializado$ = new BehaviorSubject<boolean>(false);

  /** Canal de Realtime que escucha cambios en turnos_caja. Uno solo a la vez. */
  private canalTurnos: RealtimeChannel | null = null;

  constructor() {
    // 1. Auto-inicializar cuando AuthService emita un usuario valido.
    //    Esto evita una dependencia circular explicita: AuthService no necesita
    //    llamar a TurnosCajaService — este se engancha al observable del usuario.
    //    AuthService emite en usuarioActual$ tras validarUsuario() exitoso.
    this.authService.usuarioActual$.subscribe(usuario => {
      if (usuario) {
        this.inicializarEstadoReactivo();
      } else {
        // logout / sesion expirada → reset defensivo.
        // _inicializado$ vuelve a false para que el guard espere correctamente
        // si el usuario vuelve a iniciar sesion en la misma sesion de app.
        this._turnoActivo$.next(null);
        this._inicializado$.next(false);
      }
    });

    // 2. Cerrar canal cuando se limpia la sesion via handleExpiredSession().
    //    SupabaseService expone registerBeforeCleanup como array — no pisa el
    //    listener que ya tiene registrado AuthService.
    this.supabase.registerBeforeCleanup(() => this.cerrarRealtimeTurnos());

    // 3. Borrar el snapshot del home en logout — un usuario que cambia de cuenta
    //    no debe ver datos del negocio anterior en el primer render del proximo
    //    cold start (mismo patron que ConfigService).
    this.supabase.registerBeforeCleanup(() =>
      Preferences.remove({ key: TurnosCajaService.HOME_DASHBOARD_CACHE_KEY }).catch(() => {})
    );

    // 4. Migracion: borrar el snapshot v1 huerfano (shape viejo con movimientos).
    //    Best-effort — se puede quitar esta linea en una version futura.
    Preferences.remove({ key: 'mi-tienda:home-dashboard-cache:v1' }).catch(() => {});
  }

  /** Valor sincronico del turno activo (util en codigo imperativo). */
  get turnoActivoValue(): TurnoCajaConEmpleado | null {
    return this._turnoActivo$.value;
  }

  /** Valor sincronico: true si el turno activo pertenece al usuario actual. */
  get esMiTurnoValue(): boolean {
    const turno = this._turnoActivo$.value;
    const usuario = this.authService.usuarioActualValue;
    return turno !== null && !!usuario && turno.empleado_id === usuario.id;
  }

  /**
   * Carga inicial del turno activo + apertura del canal de Realtime.
   * Se llama desde AuthService tras validarUsuario() exitoso, para que el
   * estado reactivo este listo antes de que cualquier pagina se suscriba.
   *
   * Idempotente: si ya hay un canal abierto, solo refresca el valor actual.
   */
  async inicializarEstadoReactivo(): Promise<void> {
    try {
      const turno = await this.obtenerTurnoActivo();
      this._turnoActivo$.next(turno);
      await this.sincronizarSnapshotLocal(turno);
    } catch (err) {
      // Sin red la query del turno falla; no es fatal. El estado se reconcilia
      // cuando vuelve la conexión (home llama de nuevo a inicializarEstadoReactivo).
      this.logger.error('TurnosCajaService', 'Error al inicializar estado reactivo', err);
    } finally {
      // El canal Realtime se abre SIEMPRE, aunque la query haya fallado: es
      // idempotente y no depende del resultado del turno. Así, cuando la red
      // vuelve, los cambios de turnos_caja se propagan sin esperar otra llamada.
      this.abrirRealtimeTurnos();
      this._inicializado$.next(true);
    }
  }

  /**
   * Resuelve cuando el estado de BD ya cargo (inicializarEstadoReactivo termino).
   * Usar en guards que necesitan saber si hay turno ANTES de decidir la navegacion.
   * Si ya estaba inicializado, resuelve inmediatamente sin query extra.
   */
  async esperarEstadoListo(): Promise<void> {
    if (this._inicializado$.value) return;
    await firstValueFrom(this._inicializado$.pipe(filter(v => v)));
  }

  /**
   * Abre el canal de Realtime que escucha cambios en turnos_caja.
   * Propaga automaticamente apertura (INSERT), cierre (UPDATE con
   * hora_fecha_cierre IS NOT NULL) y eliminacion (DELETE) al BehaviorSubject.
   *
   * Requiere que la tabla este publicada en Realtime con REPLICA IDENTITY FULL
   * y RLS que permita SELECT a authenticated (ver
   * docs/dashboard/sql/setup/realtime_turnos_caja.sql).
   */
  private abrirRealtimeTurnos(): void {
    if (this.canalTurnos) return; // idempotente

    try {
      const canal = this.supabase.client
        .channel('turnos-caja-activo')
        .on(
          'postgres_changes' as any,
          { event: '*', schema: 'public', table: 'turnos_caja' },
          (payload: any) => {
            this.zone.run(() => this.handleTurnoChange(payload));
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            this.logger.info('TurnosCajaService', 'Realtime turnos suscrito');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            this.logger.error('TurnosCajaService', `Realtime turnos fallo: ${status}`);
          }
        });

      this.canalTurnos = canal;
    } catch (err) {
      this.logger.error('TurnosCajaService', 'Error al abrir Realtime turnos', err);
      this.canalTurnos = null;
    }
  }

  /**
   * Procesa eventos de Realtime de turnos_caja y actualiza turnoActivo$.
   *
   * Reglas:
   * - INSERT con hora_fecha_cierre IS NULL → nuevo turno abierto → refetch
   *   (necesitamos el JOIN con empleado que el payload no trae)
   * - UPDATE: si cambio hora_fecha_cierre de null → not null, cerro el turno
   *   → turnoActivo = null
   * - DELETE del turno activo actual → turnoActivo = null
   *
   * Para INSERT hacemos refetch en lugar de construir el objeto del payload
   * porque TurnoCajaConEmpleado incluye el JOIN usuarios(nombre) que Realtime
   * no entrega. Es una query extra pero solo corre al abrir turno (infrecuente).
   */
  private async handleTurnoChange(payload: any): Promise<void> {
    const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
    const nuevo = payload.new as TurnoCaja | null;
    const viejo = payload.old as TurnoCaja | null;
    const actual = this._turnoActivo$.value;

    if (eventType === 'INSERT') {
      // Solo refetch si el INSERT es de un turno abierto
      if (nuevo && !nuevo.hora_fecha_cierre) {
        const turno = await this.obtenerTurnoActivo();
        this._turnoActivo$.next(turno);
        await this.sincronizarSnapshotLocal(turno);
        this.logger.info('TurnosCajaService', 'Turno abierto detectado en tiempo real');
      }
      return;
    }

    if (eventType === 'UPDATE') {
      // Si el turno que estaba activo se cerro, bajar el estado a null
      if (actual && nuevo && nuevo.id === actual.id && nuevo.hora_fecha_cierre) {
        this._turnoActivo$.next(null);
        await this.sincronizarSnapshotLocal(null);
        this.logger.info('TurnosCajaService', 'Turno cerrado detectado en tiempo real');
        return;
      }
      // Caso borde: un turno se reabrio (no deberia pasar, pero protegemos)
      if (!actual && nuevo && !nuevo.hora_fecha_cierre) {
        const turno = await this.obtenerTurnoActivo();
        this._turnoActivo$.next(turno);
        await this.sincronizarSnapshotLocal(turno);
      }
      return;
    }

    if (eventType === 'DELETE') {
      if (actual && viejo && viejo.id === actual.id) {
        this._turnoActivo$.next(null);
        await this.sincronizarSnapshotLocal(null);
        this.logger.warn('TurnosCajaService', 'Turno eliminado en tiempo real');
      }
    }
  }

  /**
   * Reabre el canal de Realtime de turnos con una conexión limpia, SIN resetear
   * turnoActivo$ (a diferencia de cerrarRealtimeTurnos, que es para logout).
   *
   * Necesario tras recuperar la red en un arranque offline: el canal que se intentó
   * abrir sin conexión puede haber quedado en estado CHANNEL_ERROR y no reconectar
   * solo. Lo cerramos y reabrimos para garantizar que los cambios de turnos_caja
   * vuelvan a propagarse.
   */
  async reabrirRealtimeTurnos(): Promise<void> {
    if (this.canalTurnos) {
      try {
        await this.supabase.client.removeChannel(this.canalTurnos);
      } catch (err) {
        this.logger.error('TurnosCajaService', 'Error al cerrar canal Realtime turnos (reabrir)', err);
      } finally {
        this.canalTurnos = null;
      }
    }
    this.abrirRealtimeTurnos();
  }

  /**
   * Cierra el canal de Realtime y resetea el estado.
   * Se llama automaticamente via registerBeforeCleanup cuando la sesion
   * se limpia (logout, JWT expirado, etc.).
   */
  private async cerrarRealtimeTurnos(): Promise<void> {
    if (this.canalTurnos) {
      try {
        await this.supabase.client.removeChannel(this.canalTurnos);
        this.logger.info('TurnosCajaService', 'Realtime turnos cerrado');
      } catch (err) {
        this.logger.error('TurnosCajaService', 'Error al cerrar canal Realtime turnos', err);
      } finally {
        this.canalTurnos = null;
      }
    }
    this._turnoActivo$.next(null);
  }

  /**
   * Refresca manualmente el turno activo desde la BD y emite el valor.
   * Util despues de abrirTurno() cuando queremos garantizar el estado
   * antes de que Realtime notifique (evita flash de UI).
   */
  async refrescarTurnoActivo(): Promise<void> {
    const turno = await this.obtenerTurnoActivo();
    this._turnoActivo$.next(turno);
    await this.sincronizarSnapshotLocal(turno);
  }

  /**
   * Sincroniza turnoActivo$ con el estado que reporta el servidor (fn_home_dashboard),
   * sin hacer query extra. Lo llama home.page.ts para reconciliar el BehaviorSubject
   * cuando quedó desincronizado: escenario de cold start offline donde
   * inicializarEstadoReactivo() falló sin red y la primera carga exitosa llega
   * después de recuperar conexión, o cuando el subject conserva un turno obsoleto.
   *
   * Acepta null para el caso inverso (servidor sin turno → limpiar turno fantasma).
   */
  sincronizarTurnoDesdeHome(turno: TurnoCajaConEmpleado | null): void {
    this._turnoActivo$.next(turno);
  }

  /**
   * Sincroniza el snapshot local del turno (turno_activo_local) con el estado real.
   * Habilita cobrar offline: el POS y el guard leen este snapshot cuando no hay red.
   *
   * Solo actúa con red: offline, `turno = null` puede significar "no hay turno" O
   * "la query falló por falta de red". Borrar el snapshot en ese caso destruiría el
   * turno válido que habilita el cobro offline. Sin red → no se toca el snapshot.
   * Con red, la lectura es confiable: hay turno → escribe; no hay → borra.
   */
  private async sincronizarSnapshotLocal(turno: TurnoCajaConEmpleado | null): Promise<void> {
    if (!this.network.isConnected()) return;

    if (turno) {
      await this.turnoLocal.guardar({
        turnoId:     turno.id,
        empleadoId:  turno.empleado_id,
        numeroTurno: turno.numero_turno,
        abiertoAt:   Date.now(),
      });
    } else {
      await this.turnoLocal.borrar();
    }
  }

  /**
   * Obtiene el turno activo (abierto) de hoy, si existe
   */
  async obtenerTurnoActivo(): Promise<TurnoCajaConEmpleado | null> {
    // Sin filtro de fecha: un turno abierto es uno con hora_fecha_cierre IS NULL,
    // independientemente de cuándo se abrió (puede ser de un día anterior no cerrado).
    const turno = await this.supabase.call<TurnoCajaConEmpleado>(
      this.supabase.client
        .from('turnos_caja')
        .select('*, empleado:usuarios(id, nombre)')
        .is('hora_fecha_cierre', null)
        .maybeSingle()
    );

    return turno;
  }

  /**
   * Abre un nuevo turno de caja mediante la función SQL atómica `abrir_turno`.
   *
   * Una sola transacción reemplaza las 3 queries separadas del enfoque anterior
   * (check open → count → insert), eliminando la race condition TOCTOU.
   *
   * Contrato del retorno:
   *  - `errorHandled: true`  → fue un fallo de transporte (sin red / JWT / error SQL crudo);
   *    supabase.call() ya mostró el toast y retornó null. El home no debe mostrar nada.
   *  - `errorHandled: false` + `errorMsg` → la BD rechazó la operación por una regla de
   *    negocio (ej. "Ya hay un turno abierto por X"). El mensaje lo redacta fn_abrir_turno;
   *    el home solo lo muestra tal cual. Nunca inventar aquí el texto del error.
   */
  async abrirTurno(fondoApertura: number = 0): Promise<{ ok: boolean; errorHandled: boolean; errorMsg?: string }> {
    const empleado = await this.authService.getUsuarioActual();
    if (!empleado) return { ok: false, errorHandled: false, errorMsg: 'No se pudo obtener el empleado actual' };

    const response = await this.supabase.call(
      this.supabase.client.rpc('fn_abrir_turno', {
        p_empleado_id:    empleado.id,
        p_fondo_apertura: fondoApertura
      })
    );

    // response === null → supabase.call() ya mostró el toast del error de transporte
    if (response === null) return { ok: false, errorHandled: true };

    const data = response as any;
    // success: false → la BD rechazó por regla de negocio. Propagar su mensaje (data.error)
    // — es la fuente de verdad y describe la causa real (turno ya abierto, saldo, etc.).
    if (!data?.success) {
      return { ok: false, errorHandled: false, errorMsg: data?.error ?? 'No se pudo abrir el turno' };
    }

    await this.refrescarTurnoActivo();
    await this.ui.showSuccess('Caja abierta');
    return { ok: true, errorHandled: false };
  }

  /**
   * Detecta si el último cierre tuvo déficit en la transferencia a VARIOS.
   * Con fondo libre ya no existe déficit de fondo — solo se verifica VARIOS.
   * Retorna null si no hay cierre previo o si VARIOS ya cobró ese día.
   */
  async obtenerDeficitTurnoAnterior(): Promise<{ deficitVarios: number } | null> {
    const data = await this.supabase.call<{ deficit_varios: number }>(
      this.supabase.client.rpc('fn_obtener_deficit_turno_anterior')
    );
    if (!data || data.deficit_varios <= 0) return null;
    return { deficitVarios: data.deficit_varios };
  }

  /**
   * Registra las operaciones contables para reparar el déficit del turno anterior.
   * Usa la función dedicada `reparar_deficit_turno`.
   * El RPC valida que Tienda tenga saldo suficiente — si no, retorna error con mensaje.
   *
   * Retorna { ok: true } si todo OK, o { ok: false, errorMsg } con el mensaje del RPC.
   */
  async repararDeficit(deficitVarios: number, fondoApertura: number): Promise<{ ok: boolean; turnoId?: string; errorMsg?: string }> {
    const empleado = await this.authService.getUsuarioActual();
    if (!empleado) return { ok: false, errorMsg: 'No se pudo obtener el empleado actual' };

    // Las categorías DEF-RETIRAR y DEF-REPONER son UUIDs fijos en categorias_sistema —
    // fn_reparar_deficit_turno las resuelve internamente, no las recibe como parámetros.
    const response = await this.supabase.call(
      this.supabase.client.rpc('fn_reparar_deficit_turno', {
        p_empleado_id:    empleado.id,
        p_deficit_varios: deficitVarios,
        p_fondo_apertura: fondoApertura,
      }),
      undefined,
      { showLoading: true }
    );

    if (response === null) {
      return { ok: false, errorMsg: 'Error de conexión con el servidor' };
    }

    const data = response as any;

    if (!data?.success) {
      return { ok: false, errorMsg: data?.error || 'Error desconocido al registrar el ajuste' };
    }

    // Sincronizar turnoActivo$ proactivamente (la apertura con reparacion de
    // deficit es atomica en SQL y abre el turno en la misma transaccion).
    await this.refrescarTurnoActivo();

    return { ok: true, turnoId: data.turno_id };
  }

  /**
   * Obtiene los turnos de una fecha específica (para selector en ventas).
   * Incluye nombre del empleado. Ordenados por numero_turno ASC.
   * @param fecha 'YYYY-MM-DD' — si no se pasa, usa la fecha de hoy
   */
  async obtenerTurnosDeFecha(fecha?: string): Promise<TurnoCajaConEmpleado[]> {
    const fechaLocal = fecha ?? getFechaLocal();
    const inicioDia = new Date(`${fechaLocal}T00:00:00`).toISOString();
    const finDia = getInicioDiaSiguienteDeISO(fechaLocal);

    const turnos = await this.supabase.call<TurnoCajaConEmpleado[]>(
      this.supabase.client
        .from('turnos_caja')
        .select('*, empleado:usuarios(id, nombre)')
        .gte('hora_fecha_apertura', inicioDia)
        .lt('hora_fecha_apertura', finDia)
        .order('numero_turno', { ascending: true })
    );

    return turnos ?? [];
  }


  /**
   * Snapshot consolidado del home en una sola RPC (~250-500ms vs ~400-800ms de
   * Promise.all con 9 queries individuales). Reemplaza las queries que el home
   * hacía por separado: estado de caja, saldos virtuales CELULAR/BUS y resumen
   * de ingresos/egresos del día (los métodos cliente fueron eliminados).
   *
   * v2.0: la RPC ya no devuelve la lista de movimientos — solo los agregados
   * ingresos/egresos del día completo para los deltas del hero.
   *
   * La RPC filtra todo por get_negocio_id() del JWT. Multi-tenant safe.
   */
  async obtenerHomeDashboard(): Promise<HomeDashboard> {
    const data = await this.supabase.call<{
      estado_caja: {
        turno_activo: TurnoCajaConEmpleado | null;
        turnos_hoy: number;
        fecha_ultimo_cierre: string | null;
      };
      saldos_virtuales: { celular: number; bus: number };
      resumen_dia: { ingresos: number; egresos: number };
      saldos_cajas: Caja[];
      modulos: { varios_activa: boolean; celular_habilitada: boolean; bus_habilitada: boolean };
    }>(
      this.supabase.client.rpc('fn_home_dashboard')
    );

    // Sin respuesta (offline o error de red): servir el último snapshot del día en vez
    // de pintar el home en ceros. Si tampoco hay snapshot, sigue el flujo con defaults.
    if (!data) {
      const cacheado = await this.obtenerHomeDashboardCacheado();
      if (cacheado) return cacheado;
    }

    // Defaults defensivos si la RPC retornó null (shouldn't happen pero por las dudas)
    const ec  = data?.estado_caja      ?? { turno_activo: null, turnos_hoy: 0, fecha_ultimo_cierre: null };
    const sv  = data?.saldos_virtuales ?? { celular: 0, bus: 0 };
    const res = data?.resumen_dia      ?? { ingresos: 0, egresos: 0 };
    const caj = data?.saldos_cajas     ?? [];
    const mod = data?.modulos          ?? { varios_activa: false, celular_habilitada: false, bus_habilitada: false };

    // Calcular estado a partir del turno activo y turnos del día
    let estado: EstadoCajaTipo;
    let empleadoNombre = '';
    let horaApertura = '';

    if (ec.turno_activo) {
      estado = 'TURNO_EN_CURSO';
      empleadoNombre = ec.turno_activo.empleado?.nombre || '';
      horaApertura = new Date(ec.turno_activo.hora_fecha_apertura).toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } else if (ec.turnos_hoy > 0) {
      estado = 'CERRADA';
    } else {
      estado = 'SIN_ABRIR';
    }

    const dashboard: HomeDashboard = {
      estadoCaja: {
        estado,
        turnoActivo:       ec.turno_activo,
        empleadoNombre,
        horaApertura,
        turnosHoy:         ec.turnos_hoy,
        fechaUltimoCierre: ec.fecha_ultimo_cierre,
      },
      saldoVirtualCelular: sv.celular  ?? 0,
      saldoVirtualBus:     sv.bus      ?? 0,
      ingresosHoy:         res.ingresos ?? 0,
      egresosHoy:          res.egresos  ?? 0,
      cajas:               caj,
      modulos: {
        variosActiva:      mod.varios_activa      ?? false,
        celularHabilitada: mod.celular_habilitada ?? false,
        busHabilitada:     mod.bus_habilitada     ?? false,
      },
    };

    // Persistir solo datos reales del servidor — nunca los defaults de un null
    if (data) this.guardarHomeDashboardCache(dashboard);

    return dashboard;
  }

  // ==========================================
  // SNAPSHOT PERSISTIDO DEL HOME (stale-while-revalidate)
  // ==========================================

  // v2 (2026-07-03): el shape cambió (ingresosHoy/egresosHoy en vez de la lista de
  // movimientos). Bump de la key para que un snapshot v1 persistido no se pinte con
  // campos undefined en el hero — el primer arranque tras actualizar muestra skeleton
  // una vez y desde ahí el snapshot v2 toma el relevo.
  private static readonly HOME_DASHBOARD_CACHE_KEY = 'mi-tienda:home-dashboard-cache:v2';

  /**
   * Último snapshot del dashboard persistido en Preferences, o null si no hay,
   * es de otro día o de otro negocio. El home lo pinta al instante en el cold
   * start mientras refresca contra el servidor en background.
   */
  async obtenerHomeDashboardCacheado(): Promise<HomeDashboard | null> {
    try {
      const { value } = await Preferences.get({ key: TurnosCajaService.HOME_DASHBOARD_CACHE_KEY });
      if (!value) return null;

      const snapshot: HomeDashboardSnapshot = JSON.parse(value);

      // Invalidación automática al cambiar de tenant
      if (snapshot.negocio_id !== (this.authService.usuarioActualValue?.negocio_id ?? null)) return null;

      // Solo vale el mismo día local — los turnos son diarios, un snapshot de ayer
      // pintaría un estado de turno que ya no existe
      if (snapshot.fecha !== getFechaLocal()) return null;

      return snapshot.data;
    } catch {
      return null;
    }
  }

  /** Persiste el snapshot del dashboard. Best-effort: un fallo no afecta el flujo. */
  private guardarHomeDashboardCache(dashboard: HomeDashboard): void {
    const snapshot: HomeDashboardSnapshot = {
      negocio_id: this.authService.usuarioActualValue?.negocio_id ?? null,
      fecha:      getFechaLocal(),
      data:       dashboard,
    };
    Preferences.set({
      key:   TurnosCajaService.HOME_DASHBOARD_CACHE_KEY,
      value: JSON.stringify(snapshot),
    }).catch(() => {});
  }

  /**
   * Datos iniciales del wizard de cierre diario en una sola RPC (fn_datos_cierre_diario).
   * Reemplaza las 8-9 queries paralelas que hacía cargarDatosIniciales().
   */
  async obtenerDatosCierreDiario(): Promise<DatosCierreDiario> {
    const data = await this.supabase.call<{
      turno_activo: any | null;
      saldos_virtuales:      { celular: number; bus: number };
      snapshot_virtuales:    { celular: number; bus: number };
      agregado_virtual_hoy:  { celular: number; bus: number };
      saldos_cajas:          { caja_chica_digital: number; caja_celular: number; caja_bus: number };
      saldos_antes_cierre:   { caja: number; varios: number };
      transferencia_diaria_varios: number;
      transferencia_ya_hecha: boolean;
      resumen_turno:         { ventas_pos_efectivo: number; egresos: number };
      configuracion:         { recargas_celular_habilitada: boolean; recargas_bus_habilitada: boolean; caja_varios_activa: boolean };
    }>(
      this.supabase.client.rpc('fn_datos_cierre_diario')
    );

    const sv  = data?.saldos_virtuales      ?? { celular: 0, bus: 0 };
    const sn  = data?.snapshot_virtuales    ?? { celular: 0, bus: 0 };
    const ag  = data?.agregado_virtual_hoy  ?? { celular: 0, bus: 0 };
    const sc  = data?.saldos_cajas          ?? { caja_chica_digital: 0, caja_celular: 0, caja_bus: 0 };
    const sac = data?.saldos_antes_cierre   ?? { caja: 0, varios: 0 };
    const rt  = data?.resumen_turno         ?? { ventas_pos_efectivo: 0, egresos: 0 };
    const cfg = data?.configuracion         ?? { recargas_celular_habilitada: false, recargas_bus_habilitada: false, caja_varios_activa: false };

    return {
      turnoActivo:               data?.turno_activo ?? null,
      saldosVirtuales:           { celular: sv.celular ?? 0,  bus: sv.bus ?? 0 },
      snapshotVirtuales:         { celular: sn.celular ?? 0,  bus: sn.bus ?? 0 },
      agregadoVirtualHoy:        { celular: ag.celular ?? 0,  bus: ag.bus ?? 0 },
      saldosCajas:               { cajaChicaDigital: sc.caja_chica_digital ?? 0, cajaCelular: sc.caja_celular ?? 0, cajaBus: sc.caja_bus ?? 0 },
      saldosAntesCierre:         { caja: sac.caja ?? 0, varios: sac.varios ?? 0 },
      transferenciaDiariaVarios: data?.transferencia_diaria_varios ?? 0,
      transferenciaYaHecha:      data?.transferencia_ya_hecha      ?? false,
      resumenTurno:              { ventasPosEfectivo: rt.ventas_pos_efectivo ?? 0, egresos: rt.egresos ?? 0 },
      configuracion: {
        recargasCelularHabilitada: cfg.recargas_celular_habilitada ?? false,
        recargasBusHabilitada:     cfg.recargas_bus_habilitada     ?? false,
        cajaVariosActiva:          cfg.caja_varios_activa          ?? false,
      },
    };
  }
}
