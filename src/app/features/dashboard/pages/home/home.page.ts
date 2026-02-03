import { Component, inject, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton, IonRefresher, IonRefresherContent,
  IonCard, IonIcon, IonBadge, IonButton, ModalController,
  IonList, IonItem, IonLabel, IonText
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  walletOutline, cashOutline, phonePortraitOutline, busOutline,
  chevronForwardOutline, chevronDownOutline, checkmarkCircle, closeCircle,
  arrowDownOutline, arrowUpOutline, swapHorizontalOutline,
  receiptOutline, clipboardOutline, notificationsOutline, close,
  notificationsOffOutline
} from 'ionicons/icons';
import { ScrollablePage } from '@core/pages/scrollable.page';
import { UiService } from '@core/services/ui.service';
import { RecargasService } from '../../services/recargas.service';
import { CajasService } from '../../services/cajas.service';
import { AuthService } from '../../../auth/services/auth.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton, IonRefresher, IonRefresherContent,
    IonCard, IonIcon, IonBadge, IonButton
  ]
})
export class HomePage extends ScrollablePage implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private ui = inject(UiService);
  private recargasService = inject(RecargasService);
  private cajasService = inject(CajasService);
  private authService = inject(AuthService);
  private modalCtrl = inject(ModalController);

  // Estado de la caja (se carga desde BD)
  cajaAbierta = false;

  // Saldos de cajas (se cargan desde BD)
  saldoCaja = 0;
  saldoCajaChica = 0;
  saldoCelular = 0;
  saldoBus = 0;
  totalSaldos = 0;

  // Usuario actual
  nombreUsuario = '';
  horaApertura = '7:00 AM';

  // Fechas
  fechaUltimoCierre = '';
  fechaActual = '';

  // Notificaciones
  notificacionesPendientes = 0;

  constructor() {
    super();
    addIcons({
      walletOutline, cashOutline, phonePortraitOutline, busOutline,
      chevronForwardOutline, chevronDownOutline, checkmarkCircle, closeCircle,
      arrowDownOutline, arrowUpOutline, swapHorizontalOutline,
      receiptOutline, clipboardOutline, notificationsOutline, close,
      notificationsOffOutline
    });
  }

  /**
   * Carga los datos solo la primera vez al inicializar el componente
   * Para actualizar manualmente, usar pull-to-refresh
   */
  async ngOnInit() {
    await this.cargarDatos();
  }

  /**
   * Mantiene el comportamiento de ScrollablePage (resetear scroll)
   * Carga datos solo si viene con query param refresh (ej: después de cierre)
   */
  override async ionViewWillEnter(): Promise<void> {
    super.ionViewWillEnter();

    // Check if should refresh (coming from cierre or other process)
    const refresh = this.route.snapshot.queryParams['refresh'];
    if (refresh) {
      // Clear query param first to avoid refresh loop
      await this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true
      });

      // Then refresh data
      await this.cargarDatos();
    }
  }

  /**
   * Carga el estado de la caja y todos los datos necesarios
   * Todas las consultas en paralelo para un solo loading
   */
  async cargarDatos() {
    // Ejecutar todas las consultas en paralelo (un solo loading)
    const [cajaAbierta, saldos, fechaUltimoCierre, horaApertura] = await Promise.all([
      this.cajasService.verificarEstadoCaja(),
      this.cajasService.obtenerSaldosCajas(),
      this.cajasService.obtenerFechaUltimoCierre(),
      this.cajasService.obtenerHoraApertura()
    ]);

    // Asignar estado de caja
    this.cajaAbierta = cajaAbierta;

    // Asignar saldos
    if (saldos) {
      this.saldoCaja = saldos.cajaPrincipal;
      this.saldoCajaChica = saldos.cajaChica;
      this.saldoCelular = saldos.cajaCelular;
      this.saldoBus = saldos.cajaBus;
      this.totalSaldos = saldos.total;
    }

    // Asignar fecha del último cierre
    if (fechaUltimoCierre) {
      const fecha = new Date(fechaUltimoCierre + 'T00:00:00');
      this.fechaUltimoCierre = this.formatearFecha(fecha);
    } else {
      this.fechaUltimoCierre = 'Sin cierres registrados';
    }

    // Asignar hora de apertura
    this.horaApertura = horaApertura || '7:00 AM';

    // Cargar usuario actual desde Preferences (rápido, sin consulta a BD)
    const empleado = await this.authService.getEmpleadoActual();
    this.nombreUsuario = empleado?.nombre || 'Usuario';

    // Fecha actual
    const hoy = new Date();
    this.fechaActual = this.formatearFecha(hoy);

    // TODO: Verificar notificaciones pendientes (temporal para testing)
    this.notificacionesPendientes = 1;
  }

  /**
   * Formatea una fecha al formato "3 Febrero 2026"
   */
  private formatearFecha(fecha: Date): string {
    const dia = fecha.getDate();
    const mes = fecha.toLocaleDateString('es-ES', { month: 'long' });
    const mesCapitalizado = mes.charAt(0).toUpperCase() + mes.slice(1);
    const anio = fecha.getFullYear();
    return `${dia} ${mesCapitalizado} ${anio}`;
  }

  get totalEfectivo(): number {
    return this.totalSaldos;
  }

  async handleRefresh(event: any) {
    await this.cargarDatos();
    event.target.complete();
  }

  onSaldoClick(tipo: string) {
    // TODO: Implementar navegación a detalle de caja
  }

  onOperacion(tipo: string) {
    // TODO: Implementar operaciones (ingreso, egreso, transferencia, gasto)
  }

  onCuadre() {
    // TODO: Implementar cuadre de caja
  }

  /**
   * Navega a la página de cierre diario
   * Primero verifica si ya existe un cierre para la fecha actual
   */
  async onCerrarDia() {
    await this.ui.showLoading('Verificando...');

    try {
      const existeCierre = await this.recargasService.existeCierreDiario();
      await this.ui.hideLoading();

      if (existeCierre) {
        await this.ui.showToast('Ya existe un cierre registrado para el día de hoy', 'warning');
        return;
      }

      await this.router.navigate(['/home/cierre-diario']);
    } catch (error) {
      await this.ui.hideLoading();
      await this.ui.showError('Error al verificar el cierre diario');
    }
  }

  async onAbrirDia() {
    await this.ui.showLoading('Abriendo caja...');

    try {
      // Obtener empleado actual
      const empleado = await this.authService.getEmpleadoActual();
      if (!empleado) {
        await this.ui.showError('No se pudo obtener el empleado actual');
        return;
      }

      // Abrir la caja
      await this.cajasService.abrirCaja(empleado.id);

      // Actualizar estado
      this.cajaAbierta = true;

      await this.ui.showSuccess('Caja abierta correctamente');
    } catch (error) {
      await this.ui.showError('Error al abrir la caja');
    } finally {
      await this.ui.hideLoading();
    }
  }

  async abrirNotificaciones() {
    const modal = await this.modalCtrl.create({
      component: NotificacionesModalComponent,
      cssClass: 'notificaciones-modal'
    });

    await modal.present();
  }
}

// ==========================================
// COMPONENTE MODAL DE NOTIFICACIONES
// ==========================================

@Component({
  selector: 'app-notificaciones-modal',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Notificaciones</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="cerrar()">
            <ion-icon slot="icon-only" name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-list *ngIf="notificaciones.length > 0; else sinNotificaciones">
        <ion-item *ngFor="let notif of notificaciones" button (click)="accionarNotificacion(notif)">
          <ion-icon slot="start" [name]="notif.icono" [color]="notif.color"></ion-icon>
          <ion-label>
            <h2>{{ notif.titulo }}</h2>
            <p>{{ notif.mensaje }}</p>
            <p class="ion-text-wrap">
              <ion-text color="medium">
                <small>{{ notif.detalle }}</small>
              </ion-text>
            </p>
          </ion-label>
          <ion-icon slot="end" name="chevron-forward-outline" color="medium"></ion-icon>
        </ion-item>
      </ion-list>

      <ng-template #sinNotificaciones>
        <div class="ion-padding ion-text-center">
          <ion-icon name="notifications-off-outline" size="large" color="medium"></ion-icon>
          <h3>No hay notificaciones</h3>
          <p>
            <ion-text color="medium">Todas las notificaciones están al día</ion-text>
          </p>
        </div>
      </ng-template>
    </ion-content>
  `,
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonList, IonItem, IonLabel, IonIcon, IonText
  ]
})
export class NotificacionesModalComponent {
  private modalCtrl = inject(ModalController);

  // Mock de notificaciones (después lo haremos dinámico)
  notificaciones = [
    {
      id: '1',
      tipo: 'GANANCIAS_MENSUALES',
      titulo: 'Transferir ganancias',
      mensaje: 'Enero 2026',
      detalle: 'Celular: $75.00 | Bus: $20.00 | Total: $95.00',
      icono: 'cash-outline',
      color: 'success',
      accion: () => {
        console.log('Navegar a transferir ganancias');
      }
    }
  ];

  cerrar() {
    this.modalCtrl.dismiss();
  }

  accionarNotificacion(notif: any) {
    if (notif.accion) {
      notif.accion();
    }
    this.cerrar();
  }
}
