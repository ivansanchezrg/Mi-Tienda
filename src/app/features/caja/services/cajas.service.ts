import { Injectable, inject, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from '@core/services/supabase.service';
import { AuthService } from '../../auth/services/auth.service';
import { LoggerService } from '@core/services/logger.service';
import { getFechaLocal, getInicioDiaSiguienteISO } from '@core/utils/date.util';

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

export interface SaldosCajas {
  cajaPrincipal: number;
  cajaChica: number;
  varios: number;
  cajaCelular: number;
  cajaBus: number;
  total: number;
  cajas: Caja[];
}

@Injectable({
  providedIn: 'root'
})
export class CajasService {
  private supabase = inject(SupabaseService);
  private auth     = inject(AuthService);
  private logger   = inject(LoggerService);
  private zone     = inject(NgZone);

  // ==========================================
  // ESTADO REACTIVO — lista de cajas activas
  // ==========================================

  private readonly _cajas$ = new BehaviorSubject<Caja[]>([]);
  readonly cajas$ = this._cajas$.asObservable();

  private canalCajas: RealtimeChannel | null = null;

  constructor() {
    // Auto-inicializar cuando AuthService emita un usuario valido.
    // Mismo patron que TurnosCajaService — no requiere llamada explicita.
    this.auth.usuarioActual$.subscribe(usuario => {
      if (usuario) {
        this.cargarCajasDesdeDb();
      } else {
        this._cajas$.next([]);
        this.cerrarRealtimeCajas();
      }
    });

    // Cerrar canal en logout / sesion expirada
    this.supabase.registerBeforeCleanup(() => this.cerrarRealtimeCajas());
  }

  /** Valor sincrono de las cajas (util en codigo imperativo). */
  get cajasValue(): Caja[] {
    return this._cajas$.value;
  }

  /** Calcula SaldosCajas a partir del estado reactivo actual. */
  get saldosValue(): SaldosCajas {
    return this.calcularSaldos(this._cajas$.value);
  }

  // ==========================================
  // CARGA + REALTIME
  // ==========================================

  private async cargarCajasDesdeDb(): Promise<void> {
    try {
      const cajas = await this.fetchCajas();
      this._cajas$.next(cajas);
      this.abrirRealtimeCajas();
    } catch (err) {
      this.logger.error('CajasService', 'Error al cargar cajas', err);
    }
  }

  private abrirRealtimeCajas(): void {
    if (this.canalCajas) return; // idempotente

    try {
      const canal = this.supabase.client
        .channel('cajas-saldos')
        .on(
          'postgres_changes' as any,
          { event: '*', schema: 'public', table: 'cajas' },
          (payload: any) => {
            this.zone.run(() => this.handleCajaChange(payload));
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            this.logger.info('CajasService', 'Realtime cajas suscrito');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            this.logger.error('CajasService', `Realtime cajas fallo: ${status}`);
          }
        });

      this.canalCajas = canal;
    } catch (err) {
      this.logger.error('CajasService', 'Error al abrir Realtime cajas', err);
      this.canalCajas = null;
    }
  }

  private handleCajaChange(payload: any): void {
    const eventType = payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE';
    const nueva = payload.new as Caja | null;
    const vieja = payload.old as Partial<Caja> | null;
    const actual = this._cajas$.value;

    if (eventType === 'INSERT' && nueva?.activo) {
      this._cajas$.next([...actual, nueva]);
      this.logger.info('CajasService', `Caja creada en tiempo real: ${nueva.codigo}`);
      return;
    }

    if (eventType === 'UPDATE' && nueva) {
      if (!nueva.activo) {
        // Caja desactivada — quitarla de la lista
        this._cajas$.next(actual.filter(c => c.id !== nueva.id));
      } else {
        // Actualizar saldo_actual u otros campos in-place
        this._cajas$.next(actual.map(c => c.id === nueva.id ? nueva : c));
      }
      this.logger.info('CajasService', `Caja actualizada en tiempo real: ${nueva.codigo} → $${nueva.saldo_actual}`);
      return;
    }

    if (eventType === 'DELETE' && vieja?.id) {
      this._cajas$.next(actual.filter(c => c.id !== vieja.id));
      this.logger.info('CajasService', `Caja eliminada en tiempo real: ${vieja.id}`);
    }
  }

  private async cerrarRealtimeCajas(): Promise<void> {
    if (this.canalCajas) {
      try {
        await this.supabase.client.removeChannel(this.canalCajas);
        this.logger.info('CajasService', 'Realtime cajas cerrado');
      } catch (err) {
        this.logger.error('CajasService', 'Error al cerrar canal Realtime cajas', err);
      } finally {
        this.canalCajas = null;
      }
    }
    this._cajas$.next([]);
  }

  // ==========================================
  // API PUBLICA — lectura
  // ==========================================

  /**
   * Retorna las cajas del estado reactivo en memoria.
   * Si el estado aun no cargo (primer arranque), hace un fetch y espera.
   * showLoading mantenido por compatibilidad con callers existentes.
   */
  async obtenerCajas(showLoading = false): Promise<Caja[]> {
    if (this._cajas$.value.length > 0) return this._cajas$.value;
    // Estado todavia vacio (race en primer arranque) — fetch directo
    const cajas = await this.fetchCajas(showLoading);
    if (cajas.length) this._cajas$.next(cajas);
    return cajas;
  }

  async obtenerSaldosCajas(): Promise<SaldosCajas | null> {
    const cajas = await this.obtenerCajas();
    if (!cajas.length) return null;
    return this.calcularSaldos(cajas);
  }

  async obtenerSaldoCaja(codigoCaja: string): Promise<number | null> {
    const cajas = await this.obtenerCajas();
    return cajas.find(c => c.codigo === codigoCaja)?.saldo_actual ?? null;
  }

  async obtenerCajaPorCodigo(codigoCaja: string): Promise<Caja | null> {
    const cajas = await this.obtenerCajas();
    return cajas.find(c => c.codigo === codigoCaja) ?? null;
  }

  async obtenerCajaPorNombre(nombreCaja: string): Promise<Caja | null> {
    const cajas = await this.obtenerCajas();
    return cajas.find(c => c.nombre === nombreCaja) ?? null;
  }

  async obtenerCajaPorId(id: string): Promise<Caja | null> {
    const cajas = await this.obtenerCajas();
    return cajas.find(c => c.id === id) ?? null;
  }

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

    return turno !== null;
  }

  // ==========================================
  // API PUBLICA — mutacion
  // ==========================================

  async crearCaja(nombre: string, icono: string, color: string, descripcion: string, saldoInicial: number): Promise<Caja | null> {
    const negocioId = this.auth.usuarioActualValue?.negocio_id;
    if (!negocioId) return null;

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

  async editarCaja(id: string, cambios: { nombre: string; descripcion: string; icono: string; color: string }): Promise<Caja | null> {
    return this.supabase.call<Caja>(
      this.supabase.client
        .from('cajas')
        .update({ nombre: cambios.nombre, descripcion: cambios.descripcion || null, icono: cambios.icono, color: cambios.color })
        .eq('id', id)
        .select('id, codigo, nombre, saldo_actual, activo, icono, color, descripcion')
        .single(),
      'Caja actualizada correctamente'
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

  // ==========================================
  // PRIVADO — utilidades
  // ==========================================

  private async fetchCajas(showLoading = false): Promise<Caja[]> {
    const cajas = await this.supabase.call<Caja[]>(
      this.supabase.client
        .from('cajas')
        .select('id, codigo, nombre, saldo_actual, activo, icono, color, descripcion')
        .eq('activo', true)
        .order('id'),
      undefined,
      { showLoading }
    );
    return cajas ?? [];
  }

  private calcularSaldos(cajas: Caja[]): SaldosCajas {
    const cajaPrincipal = cajas.find(c => c.codigo === 'CAJA')?.saldo_actual ?? 0;
    const cajaChica     = cajas.find(c => c.codigo === 'CAJA_CHICA')?.saldo_actual ?? 0;
    const varios        = cajas.find(c => c.codigo === 'VARIOS')?.saldo_actual ?? 0;
    const cajaCelular   = cajas.find(c => c.codigo === 'CAJA_CELULAR')?.saldo_actual ?? 0;
    const cajaBus       = cajas.find(c => c.codigo === 'CAJA_BUS')?.saldo_actual ?? 0;
    const totalCustom   = cajas
      .filter(c => c.codigo.startsWith('CUSTOM_'))
      .reduce((sum, c) => sum + c.saldo_actual, 0);
    const total = cajaPrincipal + cajaChica + varios + cajaCelular + cajaBus + totalCustom;

    return { cajaPrincipal, cajaChica, varios, cajaCelular, cajaBus, total, cajas };
  }
}
