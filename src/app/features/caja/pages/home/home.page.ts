import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton, IonRefresher, IonRefresherContent,
  IonIcon, IonButton, ModalController, IonSkeletonText
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  walletOutline, cashOutline, phonePortraitOutline, busOutline,
  chevronForward, notificationsOutline, cloudOfflineOutline,
  alertCircleOutline, eyeOutline, eyeOffOutline,
  arrowUpOutline, arrowDownOutline,
  lockClosedOutline, lockOpenOutline, warningOutline
} from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { ScrollablePage } from '@core/pages/scrollable.page';
import { UiService } from '@core/services/ui.service';
import { NetworkService } from '@core/services/network.service';
import { RecargasService } from '../../services/recargas.service';
import { CajasService, Caja } from '../../services/cajas.service';
import { OperacionesCajaService } from '../../services/operaciones-caja.service';
import { AuthService } from '../../../auth/services/auth.service';
import { ConfigService } from '@core/services/config.service';
import { RecargasVirtualesService } from '@core/services/recargas-virtuales.service';
import { TurnosCajaService } from '../../services/turnos-caja.service';
import { EstadoCaja } from '../../models/turno-caja.model';
import { NotificacionesService, Notificacion } from '@core/services/notificaciones.service';
import { NotificacionesModalComponent } from '../../components/notificaciones-modal/notificaciones-modal.component';
import { VerificarFondoModalComponent } from '../../components/verificar-fondo-modal/verificar-fondo-modal.component';
import { OperacionModalComponent, OperacionModalResult } from '../../components/operacion-modal/operacion-modal.component';
import { CierreEmergenciaModalComponent } from '../../components/cierre-emergencia-modal/cierre-emergencia-modal.component';
import { OptionsMenuComponent, MenuOption } from '../../../../shared/components/options-menu/options-menu.component';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';
import { ROUTES } from '@core/config/routes.config';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton, IonRefresher, IonRefresherContent,
    IonIcon, IonButton, IonSkeletonText,
    OptionsMenuComponent
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
  private networkService = inject(NetworkService);
  private configService  = inject(ConfigService);
  private cdr = inject(ChangeDetectorRef);

  nombreNegocio = 'Mi Tienda';
  private networkSub?: Subscription;
  private queryParamsSub?: Subscription;

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

  // Estado de conexión
  isOnline = true;

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
  esAdmin = false;

  // Fechas
  fechaUltimoCierre = '';
  fechaActual = '';

  // Notificaciones
  notificaciones: Notificacion[] = [];
  notificacionesPendientes = 0;

  // Privacidad
  montosOcultos = false;

  // Flags configuración
  variosActiva = false;
  recargasCelularHabilitada = false;
  recargasBusHabilitada = false;

  // Opciones del menú ⋮ — compartidas por todas las cajas
  readonly cajaOptions: MenuOption[] = [
    { label: 'Registrar Ingreso', icon: 'arrow-down-outline', value: 'ingreso', color: 'success' },
    { label: 'Registrar Egreso', icon: 'arrow-up-outline', value: 'egreso', color: 'danger' },
  ];


  constructor() {
    super();
    addIcons({
      walletOutline, cashOutline, phonePortraitOutline, busOutline,
      chevronForward, notificationsOutline, cloudOfflineOutline,
      alertCircleOutline, eyeOutline, eyeOffOutline,
      arrowUpOutline, arrowDownOutline,
      lockClosedOutline, lockOpenOutline, warningOutline
    });
  }

  async ngOnInit() {
    this.configService.getNombreNegocio().then(n => this.nombreNegocio = n);

    this.networkSub = this.networkService.getNetworkStatus().subscribe(isOnline => {
      this.isOnline = isOnline;
    });

    this.queryParamsSub = this.route.queryParams.subscribe(async params => {
      const action = params['action'];
      if (action) {
        await this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
        await this.manejarAccion(action);
      }
    });

    await this.cargarDatos();
  }

  ngOnDestroy() {
    this.networkSub?.unsubscribe();
    this.queryParamsSub?.unsubscribe();
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
      const [estadoCaja, saldos, fechaUltimoCierre, saldoVirtualCelular, saldoVirtualBus, notificaciones, empleado, appConfig] = await Promise.all([
        this.turnosCajaService.obtenerEstadoCaja(),
        this.cajasService.obtenerSaldosCajas(),
        this.cajasService.obtenerFechaUltimoCierre(),
        this.recargasVirtualesService.getSaldoVirtualActual('CELULAR'),
        this.recargasVirtualesService.getSaldoVirtualActual('BUS'),
        this.notificacionesService.getNotificaciones(),
        this.authService.getUsuarioActual(),
        this.configService.get()
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
      this.esAdmin = empleado?.rol === 'ADMIN';
      this.fechaActual = this.formatearFecha(new Date());

      this.notificaciones = notificaciones;
      this.notificacionesPendientes = notificaciones.length;
      this.variosActiva              = appConfig.caja_varios_activa;
      this.recargasCelularHabilitada = appConfig.recargas_celular_habilitada;
      this.recargasBusHabilitada     = appConfig.recargas_bus_habilitada;
    } catch (error: any) {
      await this.ui.showError('Error al cargar los datos. Verificá tu conexión e intentá de nuevo.');
    } finally {
      this.cargando = false;
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
    // Si no hay turno activo, el cajon (CAJA_CHICA) no se muestra en el home
    // → excluirlo del total para que la cifra mostrada coincida con las cards visibles.
    if (!this.cajaAbierta) return this.totalSaldos - this.saldoCajaChica;
    return this.totalSaldos;
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

  /** Handler del menú ⋮ en cards de Tienda y Cajón */
  async onCajaMenuOption(option: MenuOption, tipoCaja: string) {
    if (option.value === 'ver') {
      this.onSaldoClick(tipoCaja);
    } else {
      await this.onOperacion(option.value, tipoCaja);
    }
  }

  async onOperacion(tipo: string, tipoCaja?: string) {
    if (tipo === 'gasto') tipo = 'egreso';
    if (tipo !== 'ingreso' && tipo !== 'egreso') {
      await this.ui.showToast('Función no disponible aún', 'warning');
      return;
    }

    const tipoOperacion = tipo.toUpperCase() as 'INGRESO' | 'EGRESO';
    const cajaIdPreseleccionada = tipoCaja
      ? this.cajas.find(c => c.codigo === this.TIPO_CODIGO[tipoCaja])?.id
      : undefined;

    const modal = await this.modalCtrl.create({
      component: OperacionModalComponent,
      componentProps: { tipo: tipoOperacion, cajas: this.cajas, cajaIdPreseleccionada }
    });

    await modal.present();
    const { data, role } = await modal.onDidDismiss<OperacionModalResult>();
    if (role === 'confirm' && data) await this.ejecutarOperacion(tipoOperacion, data);
  }

  private async ejecutarOperacion(tipo: 'INGRESO' | 'EGRESO', data: OperacionModalResult) {
    const success = await this.operacionesCajaService.registrarOperacion(
      data.cajaId, tipo, data.categoriaId, data.monto, data.descripcion, data.fotoComprobante
    );
    if (success) await this.cargarDatos();
  }

  async onChipTurnoClick() {
    if (this.esMiTurno) {
      // Mi turno — mostrar info + opción de cerrar
      const cajaNombre = this.cajaNombreFor('CAJA_CHICA') || 'Cajón';
      const groups: ModalOptionGroup[] = [{
        options: [
          { label: 'Cerrar Turno', icon: 'lock-closed-outline', value: 'cerrar', color: 'danger' }
        ]
      }];
      const modal = await this.modalCtrl.create({
        component: OptionsModalComponent,
        componentProps: {
          title: 'Turno Activo',
          subtitle: `${cajaNombre} abierto · Ventas POS habilitadas · Desde ${this.estadoCaja.horaApertura}`,
          groups
        },
        cssClass: 'options-modal',
        breakpoints: [0, 1],
        initialBreakpoint: 1
      });
      await modal.present();
      const { data } = await modal.onDidDismiss();
      if (data === 'cerrar') await this.onCerrarCaja();

    } else if (this.cajaAbierta) {
      // Turno ajeno — informativo; admins pueden hacer cierre de emergencia
      const nombre = this.estadoCaja.empleadoNombre || 'otro empleado';
      const cajaNombre = this.cajaNombreFor('CAJA_CHICA') || 'Cajón';
      const groups: ModalOptionGroup[] = this.esAdmin
        ? [{ options: [{ label: 'Cierre de Emergencia', icon: 'warning-outline', value: 'emergencia', color: 'danger' }] }]
        : [];
      const modal = await this.modalCtrl.create({
        component: OptionsModalComponent,
        componentProps: {
          title: 'Turno en Progreso',
          subtitle: `${cajaNombre} abierto por ${nombre} · Solo ese empleado puede registrar movimientos`,
          groups
        },
        cssClass: 'options-modal',
        breakpoints: [0, 1],
        initialBreakpoint: 1
      });
      await modal.present();
      const { data } = await modal.onDidDismiss();
      if (data === 'emergencia') await this.onCierreEmergencia();

    } else {
      // Sin turno — mostrar info + opción de abrir
      const cajaNombre = this.cajaNombreFor('CAJA_CHICA') || 'Cajón';
      const groups: ModalOptionGroup[] = [{
        options: [
          { label: 'Abrir Turno', icon: 'lock-open-outline', value: 'abrir' }
        ]
      }];
      const modal = await this.modalCtrl.create({
        component: OptionsModalComponent,
        componentProps: {
          title: 'Caja Cerrada',
          subtitle: `${cajaNombre} sin turno activo · Ventas POS deshabilitadas`,
          groups
        },
        cssClass: 'options-modal',
        breakpoints: [0, 1],
        initialBreakpoint: 1
      });
      await modal.present();
      const { data } = await modal.onDidDismiss();
      if (data === 'abrir') await this.onAbrirCaja();
    }
  }

  async onCierreEmergencia() {
    if (!this.esAdmin) return;
    const turno = this.estadoCaja.turnoActivo;
    if (!turno) return;
    if (!this.empleadoActualId) return;

    const modal = await this.modalCtrl.create({
      component: CierreEmergenciaModalComponent,
      componentProps: {
        turnoId:         turno.id,
        adminId:         this.empleadoActualId,
        empleadoNombre:  this.estadoCaja.empleadoNombre || 'Empleado',
        horaApertura:    this.estadoCaja.horaApertura
      },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });

    await modal.present();
    const { role } = await modal.onDidDismiss();
    if (role === 'confirm') {
      await this.cargarDatos();
      this.cdr.detectChanges();
    }
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
      await this.irAlPOSTrasTurno();
      return;
    }

    // Caso sin déficit: abre el turno normalmente
    await this.ui.showLoading('Abriendo caja...');
    const success = await this.turnosCajaService.abrirTurno();
    await this.ui.hideLoading();

    if (success) {
      await this.cargarDatos();
      this.cdr.detectChanges();
      await this.irAlPOSTrasTurno();
    } else {
      // abrirTurno() devuelve false: puede ser turno ya abierto (datos desactualizados)
      // o error real. Verificar cuál es para dar el mensaje correcto.
      const turnoActivo = await this.turnosCajaService.obtenerTurnoActivo();
      if (turnoActivo) {
        if (turnoActivo.empleado_id === this.empleadoActualId) {
          // Lock timeout de Supabase — el turno del usuario actual ya existe
          await this.cargarDatos();
          this.cdr.detectChanges();
          await this.irAlPOSTrasTurno();
        } else {
          // Datos desactualizados — hay un turno de otro empleado abierto
          const nombre = turnoActivo.empleado?.nombre || 'otro empleado';
          await this.ui.showError(`Ya hay un turno abierto por ${nombre}. Solo ese empleado puede cerrarlo.`);
          await new Promise(resolve => setTimeout(resolve, 300));
          await this.cargarDatos();
          this.cdr.detectChanges();
        }
      } else {
        await this.ui.showError('No se pudo abrir el turno. Verificá tu conexión e intentá de nuevo.');
      }
    }
  }

  private async irAlPOSTrasTurno() {
    if (!this.esAdmin) {
      this.ui.showToast('¡Listo! Ya puedes registrar ventas', 'success');
      await new Promise(resolve => setTimeout(resolve, 600));
      this.router.navigate([ROUTES.pos]);
    } else {
      this.ui.showToast('Caja abierta', 'success');
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
      await this.ui.showError('No se pudo verificar el estado del turno. Revisá tu conexión e intentá de nuevo.');
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
        }
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
