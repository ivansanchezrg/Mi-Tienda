import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonContent, IonMenuButton, IonRefresher, IonRefresherContent,
  IonIcon, ModalController, IonSkeletonText
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  archiveOutline, cashOutline, fileTrayOutline, phonePortraitOutline, busOutline,
  notificationsOutline,
  eyeOutline, eyeOffOutline,
  arrowUpOutline, arrowDownOutline,
  lockClosedOutline, lockOpenOutline,
  createOutline, documentTextOutline,
  trendingUpOutline, trendingDownOutline,
  addOutline, removeOutline, swapHorizontalOutline,
  imageOutline,
  walletOutline, cardOutline, bagOutline, storefrontOutline, homeOutline,
  briefcaseOutline, giftOutline, shieldCheckmarkOutline
} from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { ScrollablePage } from '@core/pages/scrollable.page';
import { UiService } from '@core/services/ui.service';
import { RecargasService } from '../../services/recargas.service';
import { CajasService, Caja } from '../../services/cajas.service';
import { OperacionesCajaService } from '../../services/operaciones-caja.service';
import { AuthService } from '../../../auth/services/auth.service';
import { ConfigService } from '@core/services/config.service';
import { StorageService } from '@core/services/storage.service';
import { RecargasVirtualesService } from '../../../recargas-virtuales/services/recargas-virtuales.service';
import { TurnosCajaService } from '../../services/turnos-caja.service';
import { EstadoCaja } from '../../models/turno-caja.model';
import { NotificacionesService, Notificacion } from '@core/services/notificaciones.service';
import { NotificacionesModalComponent } from '../../components/notificaciones-modal/notificaciones-modal.component';
import { VerificarFondoModalComponent } from '../../components/verificar-fondo-modal/verificar-fondo-modal.component';
import { OperacionModalComponent, OperacionModalResult } from '../../components/operacion-modal/operacion-modal.component';
import { TraspasoModalComponent, TraspasoModalResult } from '../../components/traspaso-modal/traspaso-modal.component';
import { NuevaCajaModalComponent } from '../../components/nueva-caja-modal/nueva-caja-modal.component';
import { ROUTES } from '@core/config/routes.config';
import { OperacionCaja } from '../../models/operacion-caja.model';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonContent, IonMenuButton, IonRefresher, IonRefresherContent,
    IonIcon, IonSkeletonText,
    EmptyStateComponent
  ]
})
export class HomePage extends ScrollablePage implements OnInit, OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private ui = inject(UiService);
  private recargasService = inject(RecargasService);
  private cajasService = inject(CajasService);
  private operacionesCajaService = inject(OperacionesCajaService);
  private authService = inject(AuthService);
  private recargasVirtualesService = inject(RecargasVirtualesService);
  private turnosCajaService = inject(TurnosCajaService);
  private notificacionesService = inject(NotificacionesService);
  private modalCtrl = inject(ModalController);
  private configService  = inject(ConfigService);
  private storageService = inject(StorageService);
  private cdr = inject(ChangeDetectorRef);

  private queryParamsSub?: Subscription;
  private turnoSub?: Subscription;

  // Estado del turno de caja
  estadoCaja: EstadoCaja = {
    estado: 'SIN_ABRIR',
    turnoActivo: null,
    empleadoNombre: '',
    horaApertura: '',
    turnosHoy: 0
  };

  get cajaAbierta(): boolean {
    return this.estadoCaja.estado === 'TURNO_EN_CURSO';
  }

  /** true si el turno activo fue abierto por el usuario actual */
  get esMiTurno(): boolean {
    if (!this.cajaAbierta) return false;
    return this.estadoCaja.turnoActivo?.empleado_id === this.empleadoActualId;
  }

  // Estado de carga local (para Skeletons UI)
  cargando = true;

  // Saldos de cajas (v5: 5 cajas)
  saldoCaja = 0;
  saldoCajaChica = 0; // CAJA_CHICA — cajón físico diario
  saldoVarios = 0;    // VARIOS — fondo de emergencia (v5: antes era CAJA_CHICA)
  saldoCelular = 0;
  saldoBus = 0;
  totalSaldos = 0;
  cajas: Caja[] = [];

  // Mapa tipo-UI → codigo DB (única fuente de verdad para la navegación)
  private readonly TIPO_CODIGO: Record<string, string> = {
    'caja': 'CAJA',
    'cajaChica': 'CAJA_CHICA',
    'varios': 'VARIOS',
    'celular': 'CAJA_CELULAR',
    'bus': 'CAJA_BUS'
  };

  // Saldos virtuales
  saldoVirtualCelular = 0;
  saldoVirtualBus = 0;

  // Usuario
  nombreUsuario = '';
  empleadoActualId: string | null = null;
  esSuperadmin = false;

  // Fechas
  fechaUltimoCierre = '';

  // Notificaciones
  notificaciones: Notificacion[] = [];
  notificacionesPendientes = 0;

  // Privacidad
  montosOcultos = false;

  // Flags configuración
  variosActiva = false;
  recargasCelularHabilitada = false;
  recargasBusHabilitada = false;



  // Movimientos recientes
  ultimosMovimientos: OperacionCaja[] = [];
  cargandoMovimientos = true;

  constructor() {
    super();
    addIcons({
      archiveOutline, cashOutline, fileTrayOutline, phonePortraitOutline, busOutline,
      notificationsOutline,
      eyeOutline, eyeOffOutline,
      arrowUpOutline, arrowDownOutline,
      lockClosedOutline, lockOpenOutline,
      createOutline, documentTextOutline,
      trendingUpOutline, trendingDownOutline,
      addOutline, removeOutline, swapHorizontalOutline,
      imageOutline,
      walletOutline, cardOutline, bagOutline, storefrontOutline, homeOutline,
      briefcaseOutline, giftOutline, shieldCheckmarkOutline
    });
  }

  async ngOnInit() {

    this.queryParamsSub = this.route.queryParams.subscribe(async params => {
      const action = params['action'];
      if (action) {
        await this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
        await this.manejarAccion(action);
      }
    });

    await this.cargarDatos();

    // Sincronizar estado del chip via Realtime — cubre apertura y cierre desde otros dispositivos
    this.turnoSub = this.turnosCajaService.turnoActivo$.subscribe(turno => {
      if (turno) {
        this.estadoCaja.empleadoNombre = turno.empleado?.nombre ?? '';
        this.estadoCaja.horaApertura = new Date(turno.hora_fecha_apertura).toLocaleTimeString('es-ES', {
          hour: '2-digit', minute: '2-digit', hour12: true
        });
        this.estadoCaja.estado = 'TURNO_EN_CURSO';
        this.estadoCaja.turnoActivo = turno;
      } else {
        // Turno cerrado desde otro dispositivo — resetear todo el estado visual
        const habiaTurno = this.estadoCaja.estado === 'TURNO_EN_CURSO';
        this.estadoCaja.empleadoNombre = '';
        this.estadoCaja.horaApertura = '';
        this.estadoCaja.turnoActivo = null;
        // Si había turno activo, ese turno se acaba de cerrar → sumar al contador
        if (habiaTurno) this.estadoCaja.turnosHoy = Math.max(1, this.estadoCaja.turnosHoy);
        this.estadoCaja.estado = this.estadoCaja.turnosHoy > 0 ? 'CERRADA' : 'SIN_ABRIR';
      }
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy() {
    this.queryParamsSub?.unsubscribe();
    this.turnoSub?.unsubscribe();
  }

  private async manejarAccion(action: string) {
    if (action === 'gasto') await this.onOperacion('gasto');
  }

  override async ionViewWillEnter(): Promise<void> {
    super.ionViewWillEnter();
    this.ui.showTabs();
    const refresh = this.route.snapshot.queryParams['refresh'];
    if (refresh) {
      await this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
      await this.cargarDatos();
    }
  }

  async cargarDatos() {
    this.cargando = true;
    try {
      const [estadoCaja, saldos, fechaUltimoCierre, saldoVirtualCelular, saldoVirtualBus, notificaciones, empleado, appConfig, movimientos] = await Promise.all([
        this.turnosCajaService.obtenerEstadoCaja(),
        this.cajasService.obtenerSaldosCajas(),
        this.cajasService.obtenerFechaUltimoCierre(),
        this.recargasVirtualesService.getSaldoVirtualActual('CELULAR'),
        this.recargasVirtualesService.getSaldoVirtualActual('BUS'),
        this.notificacionesService.getNotificaciones(),
        this.authService.getUsuarioActual(),
        this.configService.get(),
        this.operacionesCajaService.obtenerUltimosMovimientos()
      ]);

      this.estadoCaja = { ...estadoCaja };

      if (saldos) {
        this.saldoCaja = saldos.cajaPrincipal;
        this.saldoCajaChica = saldos.cajaChica;
        this.saldoVarios = saldos.varios;
        this.saldoCelular = saldos.cajaCelular;
        this.saldoBus = saldos.cajaBus;
        this.totalSaldos = saldos.total;
        this.cajas = saldos.cajas;
      }

      this.saldoVirtualCelular = saldoVirtualCelular;
      this.saldoVirtualBus = saldoVirtualBus;

      if (fechaUltimoCierre) {
        this.fechaUltimoCierre = this.formatearFecha(new Date(fechaUltimoCierre + 'T00:00:00'));
      } else {
        this.fechaUltimoCierre = 'Hoy es tu primer turno';
      }

      this.nombreUsuario = empleado?.nombre || 'Usuario';
      this.empleadoActualId = empleado?.id ?? null;
      this.esSuperadmin  = empleado?.es_superadmin ?? false;

      this.notificaciones = notificaciones;
      this.notificacionesPendientes = notificaciones.length;
      this.variosActiva              = appConfig.caja_varios_activa;
      this.recargasCelularHabilitada = appConfig.recargas_celular_habilitada;
      this.recargasBusHabilitada     = appConfig.recargas_bus_habilitada;

      this.ultimosMovimientos = movimientos;
    } catch (error: any) {
      await this.ui.showError('Error al cargar los datos. Verifica tu conexión e intenta de nuevo.');
    } finally {
      this.cargando = false;
      this.cargandoMovimientos = false;
      this.cdr.detectChanges();
    }
  }

  private formatearFecha(fecha: Date): string {
    const dia = fecha.getDate();
    const mes = fecha.toLocaleDateString('es-ES', { month: 'long' });
    const anio = fecha.getFullYear();
    return `${dia} ${mes.charAt(0).toUpperCase() + mes.slice(1)} ${anio}`;
  }

  get totalEfectivo(): number {
    // Si no hay turno activo, el cajón (CAJA_CHICA) no se muestra en el home
    // → excluirlo del total para que la cifra mostrada coincida con las cards visibles.
    if (!this.cajaAbierta) return this.totalSaldos - this.saldoCajaChica;
    return this.totalSaldos;
  }

  /** Saludo dinamico segun hora local */
  get saludo(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }

  /** Fecha tipo "Sábado, 23 de mayo" */
  get fechaLarga(): string {
    const f = new Date();
    const dia = f.toLocaleDateString('es-ES', { weekday: 'long' });
    const num = f.getDate();
    const mes = f.toLocaleDateString('es-ES', { month: 'long' });
    return `${dia.charAt(0).toUpperCase() + dia.slice(1)}, ${num} de ${mes}`;
  }

  get totalIngresosHoy(): number {
    return this.ultimosMovimientos
      .filter(m => this.esMovIngreso(m.tipo_operacion))
      .reduce((acc, m) => acc + Number(m.monto), 0);
  }

  get totalEgresosHoy(): number {
    return this.ultimosMovimientos
      .filter(m => this.esMovEgreso(m.tipo_operacion))
      .reduce((acc, m) => acc + Number(m.monto), 0);
  }

  /** Cajas personalizadas creadas por el negocio (código CUSTOM_N) */
  get cajasCustom(): Caja[] {
    return this.cajas.filter(c => c.codigo.startsWith('CUSTOM_'));
  }

  /** Cuenta de cajas visibles en el grid según flags activas */
  get cajasVisibles(): number {
    let n = 2; // CAJA + CAJA_CHICA siempre
    if (this.variosActiva) n++;
    if (this.recargasCelularHabilitada) n++;
    if (this.recargasBusHabilitada) n++;
    n += this.cajasCustom.length;
    return n;
  }

  async handleRefresh(event: CustomEvent) {
    await this.cargarDatos();
    (event.target as HTMLIonRefresherElement).complete();
  }

  toggleMontosOcultos() {
    this.montosOcultos = !this.montosOcultos;
  }

  cajaNombreFor(codigo: string): string {
    return this.cajas.find(c => c.codigo === codigo)?.nombre ?? '';
  }

  /** Devuelve los 2 dígitos de centavos de un monto para el formato bancario. */
  centavos(monto: number): string {
    return monto.toFixed(2).split('.')[1];
  }

  async onNuevaCuenta() {
    const modal = await this.modalCtrl.create({
      component: NuevaCajaModalComponent,
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();
    const { role } = await modal.onDidDismiss();
    if (role === 'confirm') await this.cargarDatos();
  }

  onSaldoClickCustom(caja: Caja) {
    this.router.navigate([ROUTES.caja.operacionesCaja], {
      queryParams: { cajaId: caja.id, cajaNombre: caja.nombre, cajaCodigo: caja.codigo }
    });
  }

  onSaldoClick(tipo: string) {
    const caja = this.cajas.find(c => c.codigo === this.TIPO_CODIGO[tipo]);
    if (!caja) return;
    const esCajaChica = this.TIPO_CODIGO[tipo] === 'CAJA_CHICA';
    const turnoAjeno = esCajaChica && this.cajaAbierta && !this.esMiTurno;
    const esMiTurnoCajaChica = esCajaChica && this.esMiTurno;
    this.router.navigate([ROUTES.caja.operacionesCaja], {
      queryParams: {
        cajaId: caja.id,
        cajaNombre: caja.nombre,
        cajaCodigo: caja.codigo,
        ...(turnoAjeno ? { turnoAjeno: true } : {}),
        ...(esMiTurnoCajaChica ? { esMiTurno: true } : {})
      }
    });
  }


  async onOperacion(tipo: string, tipoCaja?: string) {
    if (tipo === 'gasto') tipo = 'egreso';

    if (tipo === 'traspaso') {
      await this.abrirTraspaso();
      return;
    }

    if (tipo !== 'ingreso' && tipo !== 'egreso') return;

    const tipoOperacion = tipo.toUpperCase() as 'INGRESO' | 'EGRESO';
    const cajaIdPreseleccionada = tipoCaja
      ? this.cajas.find(c => c.codigo === this.TIPO_CODIGO[tipoCaja])?.id
      : undefined;

    const modal = await this.modalCtrl.create({
      component: OperacionModalComponent,
      componentProps: { tipo: tipoOperacion, cajas: this.cajas, cajaIdPreseleccionada },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });

    await modal.present();
    const { data, role } = await modal.onDidDismiss<OperacionModalResult>();
    if (role === 'confirm' && data) await this.ejecutarOperacion(tipoOperacion, data);
  }

  private async abrirTraspaso() {
    await this.ui.showLoading('Cargando cajas...');
    let cajasFrescas: Caja[] = [];
    try {
      cajasFrescas = await this.cajasService.obtenerCajasDirecto();
    } catch {
      await this.ui.hideLoading();
      await this.ui.showError('No se pudo cargar la información. Verifica tu conexión.');
      return;
    }
    await this.ui.hideLoading();

    if (cajasFrescas.length < 2) {
      await this.ui.showError('Se necesitan al menos 2 cajas para realizar un traspaso.');
      return;
    }

    const modal = await this.modalCtrl.create({
      component: TraspasoModalComponent,
      componentProps: { cajas: cajasFrescas, cajaAbierta: this.cajaAbierta },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<TraspasoModalResult>();
    if (role === 'confirm' && data) {
      const success = await this.operacionesCajaService.registrarTransferencia(
        data.codigoOrigen,
        data.codigoDestino,
        data.monto,
        data.descripcion
      );
      if (success) await this.cargarDatos();
    }
  }

  private async ejecutarOperacion(tipo: 'INGRESO' | 'EGRESO', data: OperacionModalResult) {
    const success = await this.operacionesCajaService.registrarOperacion(
      data.cajaId, tipo, data.categoriaId, data.monto, data.descripcion, data.fotoComprobante
    );
    if (success) await this.cargarDatos();
  }

  async onAbrirCaja() {
    if (this.estadoCaja.estado === 'TURNO_EN_CURSO') {
      const nombre = this.estadoCaja.empleadoNombre || 'otro empleado';
      await this.ui.showError(`Ya hay un turno abierto por ${nombre}. Solo ese empleado puede cerrarlo.`);
      return;
    }

    const resultado = await this.mostrarModalVerificacionFondo();
    if (!resultado) return;

    // Si el modal ya abrió el turno (caso con déficit, atómico en SQL), no hace falta llamar abrirTurno()
    if (resultado.turnoId) {
      await this.cargarDatos();
      this.cdr.detectChanges();
      this.ui.showToast('Caja abierta', 'success');
      return;
    }

    // Caso sin déficit: abre el turno normalmente
    await this.ui.showLoading('Abriendo caja...');
    const success = await this.turnosCajaService.abrirTurno();
    await this.ui.hideLoading();

    if (success) {
      await this.cargarDatos();
      this.cdr.detectChanges();
    } else {
      // abrirTurno() devuelve false: puede ser turno ya abierto (datos desactualizados)
      // o error real. Verificar cuál es para dar el mensaje correcto.
      const turnoActivo = await this.turnosCajaService.obtenerTurnoActivo();
      if (turnoActivo) {
        if (turnoActivo.empleado_id === this.empleadoActualId) {
          // Lock timeout de Supabase — el turno del usuario actual ya existe
          await this.cargarDatos();
          this.cdr.detectChanges();
          this.ui.showToast('Caja abierta', 'success');
        } else {
          // Datos desactualizados — hay un turno de otro empleado abierto
          const nombre = turnoActivo.empleado?.nombre || 'otro empleado';
          await this.ui.showError(`Ya hay un turno abierto por ${nombre}. Solo ese empleado puede cerrarlo.`);
          await new Promise(resolve => setTimeout(resolve, 300));
          await this.cargarDatos();
          this.cdr.detectChanges();
        }
      } else {
        await this.ui.showError('No se pudo abrir el turno. Verifica tu conexión e intenta de nuevo.');
      }
    }
  }

  async onCerrarCaja() {
    if (this.estadoCaja.estado !== 'TURNO_EN_CURSO') {
      await this.ui.showToast('No hay un turno activo en este momento.', 'warning');
      return;
    }

    await this.ui.showLoading('Verificando...');
    const existeCierre = await this.recargasService.existeCierreDiario();
    await this.ui.hideLoading();

    if (existeCierre === null) {
      await this.ui.showError('No se pudo verificar el estado del turno. Revisa tu conexión e intenta de nuevo.');
      return;
    }

    if (existeCierre === true) {
      await this.ui.showToast('El turno ya tiene un cierre registrado', 'warning');
      return;
    }

    const turnoEmpleadoId = this.estadoCaja.turnoActivo?.empleado_id;
    if (turnoEmpleadoId && this.empleadoActualId && turnoEmpleadoId !== this.empleadoActualId) {
      const nombre = this.estadoCaja.empleadoNombre || 'el empleado que abrió el turno';
      await this.ui.showError(`Solo ${nombre} puede realizar el cierre de este turno.`);
      return;
    }

    await this.router.navigate([ROUTES.caja.cierreDiario]);
  }

  async abrirNotificaciones() {
    const modal = await this.modalCtrl.create({
      component: NotificacionesModalComponent,
      componentProps: { notificaciones: this.notificaciones }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.reload) await this.cargarDatos();
  }

  async onVerComprobante(mov: OperacionCaja) {
    if (!mov.comprobante_url) return;
    const url = await this.storageService.resolveImageUrl(mov.comprobante_url);
    if (!url) {
      await this.ui.showError('No se pudo cargar el comprobante');
      return;
    }
    window.open(url, '_blank');
  }

  getMovColor(tipo: string): string {
    const map: Record<string, string> = {
      INGRESO: 'success',
      EGRESO: 'danger',
      TRANSFERENCIA_ENTRANTE: 'success',
      TRANSFERENCIA_SALIENTE: 'danger',
      AJUSTE: 'warning',
      APERTURA: 'primary',
      CIERRE: 'primary'
    };
    return map[tipo] ?? 'medium';
  }

  getMovLabel(tipo: string): string {
    const map: Record<string, string> = {
      INGRESO: 'Ingreso',
      EGRESO: 'Egreso',
      TRANSFERENCIA_ENTRANTE: 'Transferencia recibida',
      TRANSFERENCIA_SALIENTE: 'Transferencia enviada',
      AJUSTE: 'Ajuste',
      APERTURA: 'Apertura',
      CIERRE: 'Cierre de turno'
    };
    return map[tipo] ?? tipo;
  }

  esMovIngreso(tipo: string): boolean {
    return ['INGRESO', 'TRANSFERENCIA_ENTRANTE'].includes(tipo);
  }

  esMovEgreso(tipo: string): boolean {
    return ['EGRESO', 'TRANSFERENCIA_SALIENTE'].includes(tipo);
  }

  formatMovHora(fecha: string): string {
    return new Date(fecha).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  }

  // ─────────────────────────────────────────────────────────────────────────

  async mostrarModalVerificacionFondo(): Promise<{ turnoId: string | null } | null> {
    try {
      await this.ui.showLoading('Verificando...');
      this.configService.invalidar(); // Fuerza lectura fresca de BD (fondo puede haber cambiado)
      const [fondoFijo, deficit] = await Promise.all([
        this.turnosCajaService.obtenerFondoFijo(),
        this.turnosCajaService.obtenerDeficitTurnoAnterior()
      ]);
      await this.ui.hideLoading();

      const modal = await this.modalCtrl.create({
        component: VerificarFondoModalComponent,
        componentProps: {
          fondoFijo,
          deficitVarios: deficit?.deficitVarios ?? 0,
          fondoFaltante: deficit?.fondoFaltante ?? 0
        },
        cssClass: 'bottom-sheet-modal',
        breakpoints: [0, 1],
        initialBreakpoint: 1,
      });

      await modal.present();
      const { data, role } = await modal.onWillDismiss();
      if (role !== 'confirm' || !data?.confirmado) return null;
      return { turnoId: data?.turnoId ?? null };
    } catch (error: any) {
      await this.ui.hideLoading();
      await this.ui.showError('Error al cargar los datos de verificación. Intentá de nuevo.');
      return null;
    }
  }
}
