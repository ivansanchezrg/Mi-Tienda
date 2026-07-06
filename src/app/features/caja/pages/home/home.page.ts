import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { App } from '@capacitor/app';
import { PluginListenerHandle } from '@capacitor/core';
import {
  IonHeader, IonToolbar, IonContent, IonMenuButton,
  IonIcon, ModalController, AlertController, IonSkeletonText,
  IonRefresher, IonRefresherContent
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  archiveOutline, cashOutline, fileTrayOutline, phonePortraitOutline, busOutline,
  notificationsOutline, arrowForwardOutline, logoWhatsapp, closeOutline, timeOutline,
  eyeOutline, eyeOffOutline,
  arrowUpOutline, arrowDownOutline,
  lockClosedOutline, lockOpenOutline,
  createOutline,
  trendingUpOutline, trendingDownOutline,
  addOutline, removeOutline, swapHorizontalOutline,
  imageOutline,
  walletOutline, cardOutline, bagOutline, storefrontOutline, homeOutline,
  briefcaseOutline, giftOutline, shieldCheckmarkOutline,
  // Todos los iconos del picker de cajas custom — necesarios para que
  // el binding dinámico [name]="caja.icono" funcione con optimization:true
  diamondOutline, trophyOutline, ribbonOutline, medalOutline,
  statsChartOutline, pieChartOutline, analyticsOutline, calculatorOutline,
  cartOutline, pricetagOutline, barcodeOutline, qrCodeOutline,
  receiptOutline, ticketOutline, basketOutline,
  businessOutline, libraryOutline, schoolOutline, buildOutline,
  hammerOutline, constructOutline, flagOutline, bookmarkOutline, keyOutline,
  carOutline, bicycleOutline, boatOutline, airplaneOutline, trainOutline, walkOutline,
  desktopOutline, laptopOutline, watchOutline, tvOutline, cameraOutline,
  restaurantOutline, pizzaOutline, beerOutline, wineOutline, cafeOutline,
  iceCreamOutline, fastFoodOutline, nutritionOutline,
  leafOutline, flowerOutline, earthOutline, sunnyOutline, moonOutline,
  waterOutline, flameOutline,
  starOutline, heartOutline, flashOutline,
  alarmOutline, peopleOutline, personOutline, settingsOutline,
  cubeOutline, layersOutline,
} from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { ScrollablePage } from '@core/pages/scrollable.page';
import { UiService } from '@core/services/ui.service';
import { RecargasService } from '../../services/recargas.service';
import { CajasService, Caja } from '../../services/cajas.service';
import { OperacionesCajaService } from '../../services/operaciones-caja.service';
import { AuthService } from '../../../auth/services/auth.service';
import { RecargasVirtualesService } from '../../../recargas-virtuales/services/recargas-virtuales.service';
import { TurnosCajaService, HomeDashboard } from '../../services/turnos-caja.service';
import { EstadoCaja } from '../../models/turno-caja.model';
import { NotificacionesService, Notificacion } from '@core/services/notificaciones.service';
import { NotificacionesModalComponent } from '../../components/notificaciones-modal/notificaciones-modal.component';
import { VerificarFondoModalComponent } from '../../components/verificar-fondo-modal/verificar-fondo-modal.component';
import { OperacionModalComponent, OperacionModalResult } from '../../components/operacion-modal/operacion-modal.component';
import { TraspasoModalComponent } from '../../components/traspaso-modal/traspaso-modal.component';
import { NuevaCajaModalComponent } from '../../components/nueva-caja-modal/nueva-caja-modal.component';
import { ROUTES } from '@core/config/routes.config';
import { ShareCierreService, DatosCierreParaCompartir } from '../../services/share-cierre.service';
import { OptionsModalComponent, ModalOptionGroup } from '@shared/components/options-modal/options-modal.component';
import { CurrencyService } from '@core/services/currency.service';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';
import { NetworkService } from '@core/services/network.service';
import { TIMING } from '@core/config/timing.config';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonContent, IonMenuButton,
    IonIcon, IonSkeletonText,
    IonRefresher, IonRefresherContent,
    AppCurrencyPipe,
  ]
})
export class HomePage extends ScrollablePage implements OnInit, OnDestroy {
  // ── Inyecciones ────────────────────────────────────────────────────────────
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
  private alertCtrl = inject(AlertController);
  private shareCierreService = inject(ShareCierreService);
  private cdr = inject(ChangeDetectorRef);
  readonly currency = inject(CurrencyService);
  private network = inject(NetworkService);
  private zone = inject(NgZone);

  // ── Subscripciones (cleanup en ngOnDestroy) ────────────────────────────────
  private queryParamsSub?: Subscription;
  private turnoSub?: Subscription;
  private cajasSub?: Subscription;
  private networkSub?: Subscription;
  private resumeListener?: PluginListenerHandle;

  /** Instante en que la app pasó a background — para decidir si refrescar al volver. */
  private backgroundAt: number | null = null;

  /**
   * Último estado de red confirmado por una emisión real del NetworkService.
   * Empieza en `undefined` (desconocido) a propósito: NO lo inicializamos desde
   * isConnected(), porque el BehaviorSubject de NetworkService arranca en `true`
   * por defecto y el valor real (offline) puede no haber llegado todavía. Dejamos
   * que la primera emisión de la suscripción lo establezca, así el flanco
   * offline→online se detecta sin importar el timing del Network.getStatus() nativo.
   */
  private ultimoEstadoRed?: boolean;

  // ── Mapa tipo-UI → código DB (única fuente de verdad para navegación) ──────
  private readonly TIPO_CODIGO: Record<string, string> = {
    'caja':      'CAJA',
    'cajaChica': 'CAJA_CHICA',
    'varios':    'VARIOS',
    'celular':   'CAJA_CELULAR',
    'bus':       'CAJA_BUS',
  };

  // ── Estado de carga ────────────────────────────────────────────────────────
  cargando = true;

  // ── Estado del turno de caja ───────────────────────────────────────────────
  estadoCaja: EstadoCaja = {
    estado: 'SIN_ABRIR',
    turnoActivo: null,
    empleadoNombre: '',
    horaApertura: '',
    turnosHoy: 0,
    fechaUltimoCierre: null
  };

  // ── Cajas y saldos (sincronizado vía Realtime en cajas$) ───────────────────
  cajas: Caja[] = [];
  saldoCaja = 0;
  saldoCajaChica = 0;
  saldoVarios = 0;
  saldoCelular = 0;
  saldoBus = 0;
  totalSaldos = 0;
  saldoVirtualCelular = 0;
  saldoVirtualBus = 0;

  // ── Usuario ────────────────────────────────────────────────────────────────
  nombreUsuario = '';
  empleadoActualId: string | null = null;
  esSuperadmin = false;

  // ── UI ─────────────────────────────────────────────────────────────────────
  fechaUltimoCierre = '';
  montosOcultos = false;

  // ── Notificaciones ─────────────────────────────────────────────────────────
  notificaciones: Notificacion[] = [];
  notificacionesPendientes = 0;

  // ── Flags de módulos habilitados (de configuraciones) ──────────────────────
  variosActiva = false;
  recargasCelularHabilitada = false;
  recargasBusHabilitada = false;

  // ── Resumen del día (deltas del hero) — agregados de fn_home_dashboard v2 ──
  ingresosHoy = 0;
  egresosHoy = 0;

  // ── Getters ────────────────────────────────────────────────────────────────
  get cajaAbierta(): boolean {
    return this.estadoCaja.estado === 'TURNO_EN_CURSO';
  }

  /** true si el turno activo fue abierto por el usuario logueado */
  get esMiTurno(): boolean {
    return this.turnosCajaService.esMiTurnoValue;
  }

  constructor() {
    super();
    addIcons({
      // Iconos del template del home
      archiveOutline, cashOutline, fileTrayOutline, phonePortraitOutline, busOutline,
      notificationsOutline, arrowForwardOutline,
      eyeOutline, eyeOffOutline,
      arrowUpOutline, arrowDownOutline,
      lockClosedOutline, lockOpenOutline,
      createOutline,
      trendingUpOutline, trendingDownOutline,
      addOutline, removeOutline, swapHorizontalOutline,
      imageOutline,

      // Iconos de cajas custom — registrados acá para que `[name]="caja.icono"`
      // funcione al renderizar cards CUSTOM_N existentes sin haber abierto antes
      // el modal NuevaCajaModal (que es donde se selecciona el icono al crear).
      // El binding dinámico evade el tree-shaking de Angular, por eso van explícitos.
      walletOutline, cardOutline, bagOutline, storefrontOutline, homeOutline,
      briefcaseOutline, giftOutline, shieldCheckmarkOutline,
      diamondOutline, trophyOutline, ribbonOutline, medalOutline,
      statsChartOutline, pieChartOutline, analyticsOutline, calculatorOutline,
      cartOutline, pricetagOutline, barcodeOutline, qrCodeOutline,
      receiptOutline, ticketOutline, basketOutline,
      businessOutline, libraryOutline, schoolOutline, buildOutline,
      hammerOutline, constructOutline, flagOutline, bookmarkOutline, keyOutline,
      carOutline, bicycleOutline, boatOutline, airplaneOutline, trainOutline, walkOutline,
      desktopOutline, laptopOutline, watchOutline, tvOutline, cameraOutline,
      restaurantOutline, pizzaOutline, beerOutline, wineOutline, cafeOutline,
      iceCreamOutline, fastFoodOutline, nutritionOutline,
      leafOutline, flowerOutline, earthOutline, sunnyOutline, moonOutline,
      waterOutline, flameOutline,
      starOutline, heartOutline, flashOutline,
      alarmOutline, peopleOutline, personOutline, settingsOutline,
      cubeOutline, layersOutline,
      logoWhatsapp, closeOutline, timeOutline,
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

    // Sincronizar saldos de cajas via Realtime — actualiza saldos y lista sin reload.
    // Las flags de visibilidad NO se recalculan aquí: vienen de fn_home_dashboard
    // (cargarDatos/refrescarDashboard) que las lee de configuraciones junto con
    // las cajas. El Realtime solo actualiza saldos entre cargas imperativas.
    this.cajasSub = this.cajasService.cajas$.subscribe(cajas => {
      if (!cajas.length) return;
      const saldos = this.cajasService.saldosValue;
      this.saldoCaja      = saldos.cajaPrincipal;
      this.saldoCajaChica = saldos.cajaChica;
      this.saldoVarios    = saldos.varios;
      this.saldoCelular   = saldos.cajaCelular;
      this.saldoBus       = saldos.cajaBus;
      this.totalSaldos    = saldos.total;
      this.cajas          = cajas;
      this.cdr.markForCheck();
    });

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

    // Re-disparo al recuperar la red — cubre el cold start offline: si la app
    // arrancó sin red, el guard offline emitió el usuario pero la carga del turno
    // (inicializarEstadoReactivo) y el dashboard fallaron sin red. Al volver online
    // reactivamos toda la cadena. El estado de red se rastrea DENTRO de la
    // suscripción (no se pre-calcula con isConnected()) para que el flanco
    // offline→online se detecte aunque el valor real llegue tarde.
    this.networkSub = this.network.getNetworkStatus().subscribe(async online => {
      const veniaDeOffline = this.ultimoEstadoRed === false;
      this.ultimoEstadoRed = online;
      if (online && veniaDeOffline) {
        await this.reactivarTrasReconexion();
      }
    });

    // Refresco silencioso al reanudar con proceso vivo (2026-07-03): si Android
    // suspendió la app sin matar el proceso, la UI reaparece al instante pero con
    // los datos del momento de la suspensión — antes quedaban viejos hasta navegar
    // o hacer pull-to-refresh. Ahora, si estuvo >= resumeHomeRefreshMinMs en
    // background, se recarga el dashboard en modo silencioso (sin skeleton, mismo
    // camino que el pull-to-refresh). La query espera internamente el refresh de
    // token en vuelo (call() → resumeRefreshInFlight) → siempre datos reales.
    // Los switches rápidos entre apps no refetchean (el Realtime cubre entre medio).
    this.setupResumeRefresh();
  }

  private async setupResumeRefresh(): Promise<void> {
    this.resumeListener = await App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        this.backgroundAt = Date.now();
        return;
      }
      const enBackgroundMs = this.backgroundAt ? Date.now() - this.backgroundAt : 0;
      this.backgroundAt = null;
      if (enBackgroundMs >= TIMING.resumeHomeRefreshMinMs) {
        // Callback de Capacitor corre fuera de Angular — re-entrar a la zona
        // para que el repintado del dashboard dispare change detection normal.
        this.zone.run(() => this.cargarDatos(true));
      }
    });
  }

  /**
   * Reactiva la cadena reactiva del home tras recuperar la conexión en un arranque
   * offline. Orden importante:
   *  1. Re-hidratar el usuario desde cache y abrir los canales Realtime de usuario
   *     (iniciarRealtimeDesdeCache es idempotente) — garantiza usuarioActualValue
   *     poblado, base de que esMiTurno pueda evaluar a true.
   *  2. Reabrir el canal Realtime de turnos con conexión limpia (el que se intentó
   *     abrir sin red pudo quedar en CHANNEL_ERROR y no reconectar solo).
   *  3. Recargar el estado del turno desde BD (reintenta la query que falló offline).
   *  4. Recargar el dashboard completo (cargarDatos → aplicarDashboard reconcilia
   *     turnoActivo$ con el servidor y repinta saldos, deltas del día y el botón de turno).
   */
  private async reactivarTrasReconexion(): Promise<void> {
    const usuario = await this.authService.getUsuarioActual();
    if (usuario) this.authService.iniciarRealtimeDesdeCache(usuario);
    await this.turnosCajaService.reabrirRealtimeTurnos();
    await this.turnosCajaService.inicializarEstadoReactivo();
    await this.cargarDatos();
  }

  ngOnDestroy() {
    this.queryParamsSub?.unsubscribe();
    this.turnoSub?.unsubscribe();
    this.cajasSub?.unsubscribe();
    this.networkSub?.unsubscribe();
    this.resumeListener?.remove();
  }

  private async manejarAccion(action: string) {
    if (action === 'gasto') await this.onOperacion('gasto');
  }

  override async ionViewWillEnter(): Promise<void> {
    super.ionViewWillEnter();
    this.ui.showTabs();

    // Detectar cierre recién ejecutado antes de refrescar —
    // si hay pendiente, hacemos cargarDatos() completo para que
    // el estado del turno y los saldos queden actualizados.
    const datosCierre = this.shareCierreService.consumirPendiente();
    if (datosCierre) {
      await this.cargarDatos();
      // Ofrecer compartir por WhatsApp solo tiene sentido cuando quien cierra
      // es un EMPLEADO: el ADMIN/dueño ya sabe lo que pasó (lo hizo él mismo)
      // y no necesita notificarse a sí mismo — para eso está el historial.
      // Un empleado sí necesita avisar al dueño ausente en tiempo real.
      if (this.authService.usuarioActualValue?.rol === 'EMPLEADO') {
        await this.ofrecerCompartirCierre(datosCierre);
      }
      await this.avisarDeficitVariosSiAplica(datosCierre);
    } else if (!this.cargando) {
      await this.refrescarDashboard();
    }
  }

  /**
   * Carga inicial del home: dashboard + notificaciones + usuario + config.
   *
   * Stale-while-revalidate: si hay un snapshot del dashboard de hoy (mismo negocio),
   * pinta el home al instante sin skeleton y el fetch de abajo actúa como refresco
   * en background. Sin snapshot (primer arranque del día), skeleton normal.
   *
   * @param silencioso true → no muestra skeleton (para pull-to-refresh). El spinner
   *                  nativo del ion-refresher hace de indicador visual.
   */
  async cargarDatos(silencioso = false) {
    if (!silencioso) {
      const snapshot = await this.turnosCajaService.obtenerHomeDashboardCacheado();
      if (snapshot) {
        this.aplicarDashboard(snapshot);
        this.cargando = false;
        this.cdr.detectChanges();
      } else {
        this.cargando = true;
      }
    }
    try {
      // 1 RPC consolidada (fn_home_dashboard) + 2 fuentes ligeras en paralelo.
      // Flags de módulos y saldos de cajas vienen en dashboard — no se necesita configService.
      const [dashboard, notificaciones, empleado] = await Promise.all([
        this.turnosCajaService.obtenerHomeDashboard(),
        this.notificacionesService.getNotificaciones(),
        this.authService.getUsuarioActual(),
      ]);

      this.aplicarDashboard(dashboard);

      this.nombreUsuario    = empleado?.nombre?.split(' ')[0] || 'Usuario';
      this.empleadoActualId = empleado?.id ?? null;
      this.esSuperadmin     = empleado?.es_superadmin ?? false;

      this.notificaciones           = notificaciones;
      this.notificacionesPendientes = notificaciones.length;
    } catch {
      await this.ui.showError('Error al cargar los datos. Verifica tu conexión e intenta de nuevo.');
    } finally {
      this.cargando = false;
      this.cdr.detectChanges();
    }
  }

  /**
   * Aplica el snapshot del dashboard a las propiedades del componente. Centraliza
   * el mapeo para evitar duplicar la lógica entre `cargarDatos()` y `refrescarDashboard()`.
   * Incluye saldos de cajas (v1.3) para que cargarDatos() sea la única fuente de verdad
   * del Home — sin depender del timing del Realtime en el dispositivo local.
   */
  private aplicarDashboard(dashboard: HomeDashboard): void {
    this.estadoCaja          = { ...dashboard.estadoCaja };
    this.saldoVirtualCelular = dashboard.saldoVirtualCelular;
    this.saldoVirtualBus     = dashboard.saldoVirtualBus;
    this.ingresosHoy         = dashboard.ingresosHoy;
    this.egresosHoy          = dashboard.egresosHoy;
    this.fechaUltimoCierre   = dashboard.estadoCaja.fechaUltimoCierre
      ? this.formatearFecha(new Date(dashboard.estadoCaja.fechaUltimoCierre + 'T00:00:00'))
      : 'Hoy es tu primer turno';

    // Reconciliar turnoActivo$ con lo que reporta el servidor. El dashboard es la
    // fuente de verdad fresca; el BehaviorSubject puede haber quedado desincronizado
    // cuando inicializarEstadoReactivo() falló sin red (cold start offline) o emitió
    // un valor obsoleto. Sin esto, `cajaAbierta` (de estadoCaja) y `esMiTurno`
    // (de turnoActivo$) discrepan y el botón de turno muestra el estado equivocado.
    // Reconciliamos en ambos sentidos: servidor con turno → empuja el turno;
    // servidor sin turno pero subject con turno fantasma → lo limpia.
    const turnoServidor = dashboard.estadoCaja.turnoActivo ?? null;
    const turnoLocal = this.turnosCajaService.turnoActivoValue;
    if (turnoServidor?.id !== turnoLocal?.id) {
      this.turnosCajaService.sincronizarTurnoDesdeHome(turnoServidor);
    }

    // Flags de visibilidad — fuente de verdad correcta por módulo:
    //   VARIOS:   cajas.activo en BD (reversible via fn_configurar_caja_varios)
    //   CELULAR/BUS: flag de configuraciones (puede existir en BD pero estar desactivada)
    this.variosActiva              = dashboard.modulos.variosActiva;
    this.recargasCelularHabilitada = dashboard.modulos.celularHabilitada;
    this.recargasBusHabilitada     = dashboard.modulos.busHabilitada;

    // Saldos de cajas frescos desde la RPC — cubre post-cierre y pull-to-refresh
    // sin depender del timing del Realtime en el dispositivo local.
    if (dashboard.cajas.length) {
      const saldos = this.cajasService.aplicarCajasExternas(dashboard.cajas);
      this.cajas          = dashboard.cajas;
      this.saldoCaja      = saldos.cajaPrincipal;
      this.saldoCajaChica = saldos.cajaChica;
      this.saldoVarios    = saldos.varios;
      this.saldoCelular   = saldos.cajaCelular;
      this.saldoBus       = saldos.cajaBus;
      this.totalSaldos    = saldos.total;
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

  /**
   * Refresco rápido del dashboard (sin notificaciones/usuario) — usado al
   * volver de subpáginas o tras una operación. 1 RPC, sin skeleton.
   */
  async refrescarDashboard() {
    try {
      const dashboard = await this.turnosCajaService.obtenerHomeDashboard();
      this.aplicarDashboard(dashboard);
    } finally {
      this.cdr.detectChanges();
    }
  }

  /**
   * Handler del pull-to-refresh del home. Recarga todo el dashboard en modo
   * silencioso — el spinner nativo del ion-refresher reemplaza el skeleton.
   * Termina el gesto con `event.target.complete()` en finally para garantizar
   * que el refresher se cierre incluso si la query falla.
   */
  async handleRefresh(event: CustomEvent) {
    try {
      await this.cargarDatos(true);
    } finally {
      (event.target as HTMLIonRefresherElement).complete();
    }
  }

  toggleMontosOcultos() {
    this.montosOcultos = !this.montosOcultos;
  }

  /** Busca una caja por código en el listado sincronizado vía Realtime. */
  cajaPorCodigo(codigo: string): Caja | undefined {
    return this.cajas.find(c => c.codigo === codigo);
  }

  async onNuevaCuenta() {
    const modal = await this.modalCtrl.create({
      component: NuevaCajaModalComponent,
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      componentProps: { cajasExistentes: this.cajas },
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

  async onSaldoClick(tipo: string) {
    const caja = this.cajas.find(c => c.codigo === this.TIPO_CODIGO[tipo]);
    if (!caja) return;

    const esCajaChica = this.TIPO_CODIGO[tipo] === 'CAJA_CHICA';

    // Cajón con turno cerrado — mostrar modal informativo
    if (esCajaChica && !this.cajaAbierta) {
      await this.mostrarModalCajonCerrado();
      return;
    }

    const esMiTurnoCajaChica = esCajaChica && this.esMiTurno;
    this.router.navigate([ROUTES.caja.operacionesCaja], {
      queryParams: {
        cajaId: caja.id,
        cajaNombre: caja.nombre,
        cajaCodigo: caja.codigo,
        ...(esMiTurnoCajaChica ? { esMiTurno: true } : {}),
        ...(caja.codigo === 'VARIOS' ? { variosActiva: this.variosActiva } : {}),
      }
    });
  }

  private async mostrarModalCajonCerrado(): Promise<void> {
    const groups: ModalOptionGroup[] = [{
      options: [
        { label: 'Historial de cierres', icon: 'time-outline', value: 'historial' },
        { label: 'Salir',                    icon: 'close-outline', value: 'cerrar'    },
      ]
    }];

    const modal = await this.modalCtrl.create({
      component: OptionsModalComponent,
      componentProps: {
        title: 'Cajón cerrado',
        groups,
      },
      cssClass: 'options-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<string>();

    if (data === 'historial') {
      this.router.navigate([ROUTES.caja.historialTurnos], { queryParams: { from: 'home' } });
    }
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
      componentProps: { tipo: tipoOperacion, cajas: this.cajas, cajaIdPreseleccionada, excluirCajaChica: !this.cajaAbierta, variosActiva: this.variosActiva },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });

    await modal.present();
    const { data, role } = await modal.onDidDismiss<OperacionModalResult>();
    if (role === 'confirm' && data) await this.ejecutarOperacion(tipoOperacion, data);
  }

  private async abrirTraspaso() {
    if (this.cajas.length < 2) {
      await this.ui.showError('Se necesitan al menos 2 cajas para realizar un traspaso.');
      return;
    }

    const modal = await this.modalCtrl.create({
      component: TraspasoModalComponent,
      componentProps: { cajas: this.cajas, cajaAbierta: this.cajaAbierta, variosActiva: this.variosActiva },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();

    const { role } = await modal.onDidDismiss();
    if (role === 'confirm') await this.refrescarDashboard();
  }

  private async ejecutarOperacion(tipo: 'INGRESO' | 'EGRESO', data: OperacionModalResult) {
    const success = await this.operacionesCajaService.registrarOperacion(
      data.cajaId, tipo, data.categoriaId, data.monto, data.descripcion, data.fotoComprobante
    );
    if (success) await this.refrescarDashboard();
  }

  async onAbrirCaja() {
    // Abrir turno es una escritura: requiere red. Sin conexión no abrimos el modal
    // de verificación de fondo — además de ser inútil (fn_abrir_turno fallaría),
    // la verificación de déficit del cierre anterior no se puede consultar offline
    // y abriríamos un turno con un déficit pendiente silenciado. El usuario ya ve
    // el aviso "Sin conexión" en el home, así que el mensaje cierra el porqué.
    if (!this.network.isConnected()) {
      await this.ui.showError('Sin conexión a internet. No puedes abrir un turno.');
      return;
    }

    if (this.estadoCaja.estado === 'TURNO_EN_CURSO') {
      const nombre = this.estadoCaja.empleadoNombre || 'otro empleado';
      await this.ui.showError(`Ya hay un turno abierto por ${nombre}. Solo ese empleado puede cerrarlo.`);
      return;
    }

    const resultado = await this.mostrarModalVerificacionFondo();
    if (!resultado) return;

    // Caso sin déficit: el modal devuelve fondoApertura y el home ejecuta abrirTurno()
    // Caso con déficit: el modal ya ejecutó repararDeficit() internamente (turnoId viene poblado)
    if (!resultado.turnoId) {
      const { ok, errorHandled, errorMsg } = await this.turnosCajaService.abrirTurno(resultado.fondoApertura);
      if (!ok) {
        // errorHandled → transporte (sin red/JWT): supabase.call() ya mostró el toast.
        // Si no, la BD rechazó por regla de negocio: mostramos su mensaje real (ej. "Ya
        // hay un turno abierto por X") y refrescamos para sincronizar el estado del chip
        // —cubre el caso de carrera donde otro dispositivo abrió y Realtime aún no llegó.
        if (!errorHandled) {
          await this.ui.showError(errorMsg ?? 'No se pudo abrir el turno. Intenta de nuevo.');
          await this.cargarDatos();
        }
        return;
      }
    }

    await this.cargarDatos();
    this.cdr.detectChanges();
  }

  async onCerrarCaja() {
    // Cerrar turno es una escritura (verifica cierre + navega al wizard que ejecuta
    // fn_ejecutar_cierre_diario): requiere red. Sin conexión bloqueamos en la puerta,
    // mismo criterio que abrir turno e ingreso/egreso.
    if (!this.network.isConnected()) {
      await this.ui.showError('Sin conexión a internet. No puedes cerrar el turno.');
      return;
    }

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

  private async ofrecerCompartirCierre(datos: DatosCierreParaCompartir): Promise<void> {
    const groups: ModalOptionGroup[] = [{
      options: [
        { label: 'Enviar resumen', icon: 'logo-whatsapp', value: 'enviar' },
        { label: 'Omitir',         icon: 'close-outline',  value: 'omitir' },
      ]
    }];

    const modal = await this.modalCtrl.create({
      component: OptionsModalComponent,
      componentProps: {
        title:    'Cierre registrado',
        subtitle: `Cajero: ${datos.cajeroNombre}`,
        groups
      },
      cssClass: 'options-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();

    if (data === 'enviar') {
      await this.shareCierreService.enviarResumenWhatsApp(datos);
    }
  }

  /**
   * Turno abierto un día anterior: la transferencia diaria a Varios de ese día
   * no se realizó. Caso excepcional — alert (no toast) para que no se pierda.
   * La compensación es deliberadamente manual: traspaso Tienda → Varios.
   * Independiente del rol de quien cierra (a diferencia de ofrecerCompartirCierre):
   * el déficit afecta al negocio sin importar quién esté cerrando el turno.
   */
  private async avisarDeficitVariosSiAplica(datos: DatosCierreParaCompartir): Promise<void> {
    if (!datos.aperturaEnOtroDia || !datos.variosActiva) return;

    const fecha = this.formatearFecha(new Date(datos.horaApertura));
    const alert = await this.alertCtrl.create({
      header: 'Transferencia a Varios pendiente',
      message: `Este turno se abrió el ${fecha} y se cerró hoy. La transferencia diaria a Varios del día anterior no se realizó. Si quieres compensarla, haz un traspaso manual de Tienda a Varios.`,
      buttons: ['Entendido'],
    });
    await alert.present();
  }

  async mostrarModalVerificacionFondo(): Promise<{ turnoId: string | null; fondoApertura: number } | null> {
    try {
      await this.ui.showLoading('Verificando...');
      const deficit = await this.turnosCajaService.obtenerDeficitTurnoAnterior();
      await this.ui.hideLoading();

      const modal = await this.modalCtrl.create({
        component: VerificarFondoModalComponent,
        componentProps: {
          deficitVarios: deficit?.deficitVarios ?? 0,
        },
        cssClass: 'bottom-sheet-modal',
        breakpoints: [0, 1],
        initialBreakpoint: 1,
      });

      await modal.present();
      const { data, role } = await modal.onWillDismiss();
      if (role !== 'confirm' || !data?.confirmado) return null;
      return { turnoId: data?.turnoId ?? null, fondoApertura: data?.fondoApertura ?? 0 };
    } catch {
      await this.ui.hideLoading();
      await this.ui.showError('Error al cargar los datos de verificación. Intenta de nuevo.');
      return null;
    }
  }
}
