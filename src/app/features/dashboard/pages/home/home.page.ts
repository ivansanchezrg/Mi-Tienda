import { Component, inject, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton, IonRefresher, IonRefresherContent,
  IonIcon, IonButton, ModalController, ToastController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  walletOutline, cashOutline, phonePortraitOutline, busOutline,
  chevronForward, notificationsOutline, cloudOfflineOutline,
  alertCircleOutline, eyeOutline, eyeOffOutline
} from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { ScrollablePage } from '@core/pages/scrollable.page';
import { UiService } from '@core/services/ui.service';
import { NetworkService } from '@core/services/network.service';
import { RecargasService } from '../../services/recargas.service';
import { CajasService, Caja } from '../../services/cajas.service';
import { OperacionesCajaService } from '../../services/operaciones-caja.service';
import { AuthService } from '../../../auth/services/auth.service';
import { RecargasVirtualesService } from '@core/services/recargas-virtuales.service';
import { TurnosCajaService } from '../../services/turnos-caja.service';
import { EstadoCaja } from '../../models/turno-caja.model';
import { NotificacionesService, Notificacion } from '../../services/notificaciones.service';
import { NotificacionesModalComponent } from '../../components/notificaciones-modal/notificaciones-modal.component';
import { VerificarFondoModalComponent } from '../../components/verificar-fondo-modal/verificar-fondo-modal.component';
import { OperacionModalComponent, OperacionModalResult } from '../../components/operacion-modal/operacion-modal.component';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton, IonRefresher, IonRefresherContent,
    IonIcon, IonButton
  ]
})
export class HomePage extends ScrollablePage implements OnInit, OnDestroy {
  private router                  = inject(Router);
  private route                   = inject(ActivatedRoute);
  private ui                      = inject(UiService);
  private recargasService         = inject(RecargasService);
  private cajasService            = inject(CajasService);
  private operacionesCajaService  = inject(OperacionesCajaService);
  private authService             = inject(AuthService);
  private recargasVirtualesService = inject(RecargasVirtualesService);
  private turnosCajaService       = inject(TurnosCajaService);
  private notificacionesService   = inject(NotificacionesService);
  private modalCtrl               = inject(ModalController);
  private toastCtrl               = inject(ToastController);
  private networkService          = inject(NetworkService);
  private cdr                     = inject(ChangeDetectorRef);
  private networkSub?: Subscription;

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

  // Estado de conexión
  isOnline = true;

  // Saldos de cajas
  saldoCaja       = 0;
  saldoCajaChica  = 0;
  saldoCelular    = 0;
  saldoBus        = 0;
  totalSaldos     = 0;
  cajas: Caja[]   = [];

  // Saldos virtuales
  saldoVirtualCelular = 0;
  saldoVirtualBus     = 0;

  // Usuario
  nombreUsuario = '';

  // Fechas
  fechaUltimoCierre = '';
  fechaActual       = '';

  // Notificaciones
  notificaciones: Notificacion[] = [];
  notificacionesPendientes = 0;

  // Privacidad
  montosOcultos = false;

  constructor() {
    super();
    addIcons({
      walletOutline, cashOutline, phonePortraitOutline, busOutline,
      chevronForward, notificationsOutline, cloudOfflineOutline,
      alertCircleOutline, eyeOutline, eyeOffOutline
    });
  }

  async ngOnInit() {
    this.networkSub = this.networkService.getNetworkStatus().subscribe(isOnline => {
      this.isOnline = isOnline;
    });

    this.route.queryParams.subscribe(async params => {
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
  }

  private async manejarAccion(action: string) {
    if (action === 'gasto') await this.onOperacion('gasto');
  }

  override async ionViewWillEnter(): Promise<void> {
    super.ionViewWillEnter();
    const refresh = this.route.snapshot.queryParams['refresh'];
    if (refresh) {
      await this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
      await this.cargarDatos();
    }
  }

  async cargarDatos() {
    try {
      const [estadoCaja, saldos, fechaUltimoCierre, saldoVirtualCelular, saldoVirtualBus, notificaciones] = await Promise.all([
        this.turnosCajaService.obtenerEstadoCaja(),
        this.cajasService.obtenerSaldosCajas(),
        this.cajasService.obtenerFechaUltimoCierre(),
        this.recargasVirtualesService.getSaldoVirtualActual('CELULAR'),
        this.recargasVirtualesService.getSaldoVirtualActual('BUS'),
        this.notificacionesService.getNotificaciones()
      ]);

      this.estadoCaja = { ...estadoCaja };

      if (saldos) {
        this.saldoCaja      = saldos.cajaPrincipal;
        this.saldoCajaChica = saldos.cajaChica;
        this.saldoCelular   = saldos.cajaCelular;
        this.saldoBus       = saldos.cajaBus;
        this.totalSaldos    = saldos.total;
        this.cajas          = saldos.cajas;
      }

      this.saldoVirtualCelular = saldoVirtualCelular;
      this.saldoVirtualBus     = saldoVirtualBus;

      if (fechaUltimoCierre) {
        this.fechaUltimoCierre = this.formatearFecha(new Date(fechaUltimoCierre + 'T00:00:00'));
      } else {
        this.fechaUltimoCierre = 'Sin cierres registrados';
      }

      const empleado = await this.authService.getUsuarioActual();
      this.nombreUsuario = empleado?.nombre || 'Usuario';
      this.fechaActual   = this.formatearFecha(new Date());

      this.notificaciones          = notificaciones;
      this.notificacionesPendientes = notificaciones.length;
    } catch (error: any) {
      await this.ui.showError('Error al cargar los datos. Verificá tu conexión e intentá de nuevo.');
    }
  }

  private formatearFecha(fecha: Date): string {
    const dia = fecha.getDate();
    const mes = fecha.toLocaleDateString('es-ES', { month: 'long' });
    const anio = fecha.getFullYear();
    return `${dia} ${mes.charAt(0).toUpperCase() + mes.slice(1)} ${anio}`;
  }

  get totalEfectivo(): number {
    return this.totalSaldos;
  }

  async handleRefresh(event: any) {
    await this.cargarDatos();
    event.target.complete();
  }

  toggleMontosOcultos() {
    this.montosOcultos = !this.montosOcultos;
  }

  onSaldoClick(tipo: string) {
    const cajas: Record<string, { id: number; nombre: string }> = {
      'caja':      { id: 1, nombre: 'Tienda' },
      'cajaChica': { id: 2, nombre: 'Varios' },
      'celular':   { id: 3, nombre: 'Celular' },
      'bus':       { id: 4, nombre: 'Bus' }
    };
    const caja = cajas[tipo];
    if (!caja) return;
    this.router.navigate(['/home/operaciones-caja'], { state: { cajaId: caja.id, cajaNombre: caja.nombre } });
  }

  async onOperacion(tipo: string, tipoCaja?: string) {
    if (tipo === 'gasto') tipo = 'egreso';
    if (tipo !== 'ingreso' && tipo !== 'egreso') {
      await this.ui.showToast('Función no disponible aún', 'warning');
      return;
    }

    const tipoOperacion = tipo.toUpperCase() as 'INGRESO' | 'EGRESO';
    const cajaIds: Record<string, number> = { 'caja': 1, 'cajaChica': 2, 'celular': 3, 'bus': 4 };
    const cajaIdPreseleccionada = tipoCaja ? cajaIds[tipoCaja] : undefined;

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

  async onAbrirCaja() {
    const confirmado = await this.mostrarModalVerificacionFondo();
    if (!confirmado) return;

    const success = await this.turnosCajaService.abrirTurno();
    if (success) {
      await new Promise(resolve => setTimeout(resolve, 300));
      await this.cargarDatos();
      this.cdr.detectChanges();
    } else {
      await this.ui.showError('No se pudo abrir el turno. Verificá tu conexión e intentá de nuevo.');
    }
  }

  async onCerrarCaja() {
    if (!this.estadoCaja.turnoActivo) return;
    await this.onCerrarDia();
  }

  async onCerrarDia() {
    if (this.estadoCaja.estado !== 'TURNO_EN_CURSO') {
      const toast = await this.toastCtrl.create({
        message: 'Debes abrir la caja primero antes de hacer el cierre diario',
        duration: 3000, color: 'warning', position: 'top', icon: 'alert-circle-outline'
      });
      await toast.present();
      return;
    }

    await this.ui.showLoading('Verificando...');
    const existeCierre = await this.recargasService.existeCierreDiario();
    await this.ui.hideLoading();

    if (existeCierre === null) {
      const toast = await this.toastCtrl.create({
        message: 'No se pudo verificar el estado de la caja. Revisa tu conexión a internet.',
        duration: 3000, color: 'danger', position: 'top', icon: 'cloud-offline-outline'
      });
      await toast.present();
      return;
    }

    if (existeCierre === true) {
      await this.ui.showToast('Ya existe un cierre registrado para el día de hoy', 'warning');
      return;
    }

    await this.router.navigate(['/home/cierre-diario']);
  }

  async abrirNotificaciones() {
    const modal = await this.modalCtrl.create({
      component: NotificacionesModalComponent,
      cssClass: 'notificaciones-modal',
      componentProps: { notificaciones: this.notificaciones }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.reload) await this.cargarDatos();
  }

  async mostrarModalVerificacionFondo(): Promise<boolean> {
    try {
      const [fondoFijo, deficit] = await Promise.all([
        this.turnosCajaService.obtenerFondoFijo(),
        this.turnosCajaService.obtenerDeficitTurnoAnterior()
      ]);

      const modal = await this.modalCtrl.create({
        component: VerificarFondoModalComponent,
        cssClass: 'verificar-fondo-modal',
        componentProps: {
          fondoFijo,
          deficitCajaChica: deficit?.deficitCajaChica ?? 0,
          fondoFaltante:    deficit?.fondoFaltante ?? 0
        }
      });

      await modal.present();
      const { data, role } = await modal.onWillDismiss();
      return role === 'confirm' && data?.confirmado === true;
    } catch (error: any) {
      await this.ui.showError('Error al cargar los datos de verificación. Intentá de nuevo.');
      return false;
    }
  }
}
