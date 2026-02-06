import { Component, inject, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton, IonRefresher, IonRefresherContent,
  IonCard, IonIcon, IonBadge, IonButton, ModalController,
  IonList, IonItem, IonLabel, IonText, ToastController, ActionSheetController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  walletOutline, cashOutline, phonePortraitOutline, busOutline,
  chevronForwardOutline, chevronDownOutline, checkmarkCircle, closeCircle,
  arrowDownOutline, arrowUpOutline, swapHorizontalOutline,
  receiptOutline, clipboardOutline, notificationsOutline, close,
  notificationsOffOutline, cloudOfflineOutline, alertCircleOutline,
  ellipsisVertical, listOutline, lockOpenOutline, lockClosedOutline
} from 'ionicons/icons';
import { ScrollablePage } from '@core/pages/scrollable.page';
import { UiService } from '@core/services/ui.service';
import { NetworkService } from '@core/services/network.service';
import { RecargasService } from '../../services/recargas.service';
import { CajasService, Caja } from '../../services/cajas.service';
import { OperacionesCajaService } from '../../services/operaciones-caja.service';
import { AuthService } from '../../../auth/services/auth.service';
import { GananciasService, GananciasPendientes } from '../../services/ganancias.service';
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
    IonCard, IonIcon, IonBadge, IonButton
  ]
})
export class HomePage extends ScrollablePage implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private ui = inject(UiService);
  private recargasService = inject(RecargasService);
  private cajasService = inject(CajasService);
  private operacionesCajaService = inject(OperacionesCajaService);
  private authService = inject(AuthService);
  private gananciasService = inject(GananciasService);
  private modalCtrl = inject(ModalController);
  private toastCtrl = inject(ToastController);
  private actionSheetCtrl = inject(ActionSheetController);
  private networkService = inject(NetworkService);

  // Estado de la caja (se carga desde BD)
  cajaAbierta = false;

  // Estado de conexión
  isOnline = true;

  // Saldos de cajas (se cargan desde BD)
  saldoCaja = 0;
  saldoCajaChica = 0;
  saldoCelular = 0;
  saldoBus = 0;
  totalSaldos = 0;
  cajas: Caja[] = [];

  // Usuario actual
  nombreUsuario = '';

  // Fechas
  fechaUltimoCierre = '';
  fechaActual = '';

  // Notificaciones
  notificacionesPendientes = 0;
  gananciasPendientes: GananciasPendientes | null = null;

  constructor() {
    super();
    addIcons({
      walletOutline, cashOutline, phonePortraitOutline, busOutline,
      chevronForwardOutline, chevronDownOutline, checkmarkCircle, closeCircle,
      arrowDownOutline, arrowUpOutline, swapHorizontalOutline,
      receiptOutline, clipboardOutline, notificationsOutline, close,
      notificationsOffOutline, cloudOfflineOutline, alertCircleOutline,
      ellipsisVertical, listOutline, lockOpenOutline, lockClosedOutline
    });
  }

  /**
   * Carga los datos solo la primera vez al inicializar el componente
   * Para actualizar manualmente, usar pull-to-refresh
   */
  async ngOnInit() {
    // Suscribirse al estado de red
    this.networkService.getNetworkStatus().subscribe(isOnline => {
      this.isOnline = isOnline;
    });

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
   * Carga el estado de la caja y todos los datos necesarios (Versión 2.0)
   * Todas las consultas en paralelo para un solo loading
   * NOTA: En v2.0, la apertura es implícita (ausencia de cierre para hoy)
   */
  async cargarDatos() {
    // Ejecutar todas las consultas en paralelo (un solo loading)
    const [cajaAbierta, saldos, fechaUltimoCierre, gananciasPendientes] = await Promise.all([
      this.cajasService.verificarEstadoCaja(),
      this.cajasService.obtenerSaldosCajas(),
      this.cajasService.obtenerFechaUltimoCierre(),
      this.gananciasService.verificarGananciasPendientes()
    ]);

    // Asignar estado de caja
    this.cajaAbierta = cajaAbierta;

    // Asignar saldos y cajas
    if (saldos) {
      this.saldoCaja = saldos.cajaPrincipal;
      this.saldoCajaChica = saldos.cajaChica;
      this.saldoCelular = saldos.cajaCelular;
      this.saldoBus = saldos.cajaBus;
      this.totalSaldos = saldos.total;
      this.cajas = saldos.cajas;
    }

    // Asignar fecha del último cierre
    if (fechaUltimoCierre) {
      const fecha = new Date(fechaUltimoCierre + 'T00:00:00');
      this.fechaUltimoCierre = this.formatearFecha(fecha);
    } else {
      this.fechaUltimoCierre = 'Sin cierres registrados';
    }

    // Cargar usuario actual desde Preferences (rápido, sin consulta a BD)
    const empleado = await this.authService.getEmpleadoActual();
    this.nombreUsuario = empleado?.nombre || 'Usuario';

    // Fecha actual
    const hoy = new Date();
    this.fechaActual = this.formatearFecha(hoy);

    // Verificar ganancias pendientes
    this.gananciasPendientes = gananciasPendientes;
    this.notificacionesPendientes = gananciasPendientes ? 1 : 0;
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

  /**
   * Muestra el menú de opciones para una caja específica
   */
  async mostrarMenuCaja(event: Event, tipo: string) {
    // Prevenir que el click se propague al contenedor
    event.stopPropagation();

    // Verificar conexión
    if (!this.isOnline) {
      await this.ui.showError('Sin conexión a internet. No puedes realizar operaciones.');
      return;
    }

    // Mapeo de nombres para el action sheet
    const nombresCortos = {
      'caja': 'Caja Principal',
      'cajaChica': 'Caja Chica',
      'celular': 'Celular',
      'bus': 'Bus'
    };

    const actionSheet = await this.actionSheetCtrl.create({
      header: nombresCortos[tipo as keyof typeof nombresCortos],
      cssClass: 'caja-action-sheet',  // Clase personalizada para estilos
      buttons: [
        {
          text: 'Ver movimientos',
          icon: 'list-outline',
          cssClass: 'action-sheet-primary',
          handler: () => {
            this.onSaldoClick(tipo);
          }
        },
        {
          text: 'Ingreso',
          icon: 'arrow-down-outline',
          cssClass: 'action-sheet-success',
          handler: () => {
            this.onOperacion('ingreso', tipo);
          }
        },
        {
          text: 'Egreso',
          icon: 'arrow-up-outline',
          cssClass: 'action-sheet-danger',
          handler: () => {
            this.onOperacion('egreso', tipo);
          }
        },
        {
          text: 'Cancelar',
          icon: 'close',
          role: 'cancel',
          cssClass: 'action-sheet-cancel'
        }
      ]
    });

    await actionSheet.present();
  }

  onSaldoClick(tipo: string) {
    // Mapeo de tipos a IDs y nombres de cajas
    const cajas = {
      'caja': { id: 1, nombre: 'Caja Principal' },
      'cajaChica': { id: 2, nombre: 'Caja Chica' },
      'celular': { id: 3, nombre: 'Celular' },
      'bus': { id: 4, nombre: 'Bus' }
    };

    const caja = cajas[tipo as keyof typeof cajas];
    if (!caja) return;

    this.router.navigate(['/home/operaciones-caja'], {
      state: {
        cajaId: caja.id,
        cajaNombre: caja.nombre
      }
    });
  }

  async onOperacion(tipo: string, tipoCaja?: string) {
    // Solo ingreso y egreso por ahora
    if (tipo !== 'ingreso' && tipo !== 'egreso') {
      await this.ui.showToast('Función no disponible aún', 'warning');
      return;
    }

    const tipoOperacion = tipo.toUpperCase() as 'INGRESO' | 'EGRESO';

    // Si se especificó una caja, obtener su ID
    let cajaIdPreseleccionada: number | undefined;
    if (tipoCaja) {
      const cajas = {
        'caja': 1,
        'cajaChica': 2,
        'celular': 3,
        'bus': 4
      };
      cajaIdPreseleccionada = cajas[tipoCaja as keyof typeof cajas];
    }

    const modal = await this.modalCtrl.create({
      component: OperacionModalComponent,
      componentProps: {
        tipo: tipoOperacion,
        cajas: this.cajas,
        cajaIdPreseleccionada // Nueva prop para pre-seleccionar caja
      }
    });

    await modal.present();
    const { data, role } = await modal.onDidDismiss<OperacionModalResult>();

    if (role === 'confirm' && data) {
      await this.ejecutarOperacion(tipoOperacion, data);
    }
  }

  private async ejecutarOperacion(tipo: 'INGRESO' | 'EGRESO', data: OperacionModalResult) {
    // El servicio maneja loading, empleado, subida de foto y guardado
    const success = await this.operacionesCajaService.registrarOperacion(
      data.cajaId,
      tipo,
      data.monto,
      data.descripcion,
      data.fotoComprobante
    );

    if (success) {
      // Recargar datos para actualizar saldos
      await this.cargarDatos();
    }
  }

  onCuadre() {
    this.router.navigate(['/home/cuadre-caja']);
  }

  /**
   * Navega a la página de cierre diario
   * Primero verifica si ya existe un cierre para la fecha actual
   */
  async onCerrarDia() {
    await this.ui.showLoading('Verificando...');

    const existeCierre = await this.recargasService.existeCierreDiario();
    await this.ui.hideLoading();

    // Si hay error de conexión (null), mostrar error y no navegar
    if (existeCierre === null) {
      const toast = await this.toastCtrl.create({
        message: 'No se pudo verificar el estado de la caja. Revisa tu conexión a internet.',
        duration: 3000,
        color: 'danger',
        position: 'top',
        icon: 'cloud-offline-outline'
      });
      await toast.present();
      return;
    }

    // Si ya existe cierre (true), mostrar advertencia y no navegar
    if (existeCierre === true) {
      await this.ui.showToast('Ya existe un cierre registrado para el día de hoy', 'warning');
      return;
    }

    // Si no existe cierre (false), navegar a la página de cierre diario
    await this.router.navigate(['/home/cierre-diario']);
  }

  /**
   * Inicia el día llevando al usuario a la página de cierre diario
   * Verifica ANTES de navegar si ya existe un cierre para evitar mostrar UI innecesaria
   */
  async onAbrirDia() {
    // Verificar si ya existe un cierre para hoy ANTES de navegar
    const yaExisteCierre = await this.recargasService.existeCierreDiario();

    // Si hay error de conexión (null), mostrar error y no navegar
    if (yaExisteCierre === null) {
      const toast = await this.toastCtrl.create({
        message: 'No se pudo verificar el estado de la caja. Revisa tu conexión a internet.',
        duration: 3000,
        color: 'danger',
        position: 'top',
        icon: 'cloud-offline-outline'
      });
      await toast.present();
      return;
    }

    // Si ya existe cierre (true), mostrar advertencia y no navegar
    if (yaExisteCierre === true) {
      const toast = await this.toastCtrl.create({
        message: 'La caja ya fue cerrada hoy. No puedes realizar otro cierre para la misma fecha.',
        duration: 3000,
        color: 'warning',
        position: 'top',
        icon: 'alert-circle-outline'
      });
      await toast.present();
      return;
    }

    // Si no existe cierre (false), navegar a la página de cierre diario
    await this.router.navigate(['/home/cierre-diario']);
  }

  async abrirNotificaciones() {
    const modal = await this.modalCtrl.create({
      component: NotificacionesModalComponent,
      cssClass: 'notificaciones-modal',
      componentProps: {
        gananciasPendientes: this.gananciasPendientes
      }
    });

    await modal.present();

    // Si se confirma una acción, recargar datos
    const { data } = await modal.onWillDismiss();
    if (data?.reload) {
      await this.cargarDatos();
    }
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
export class NotificacionesModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private router = inject(Router);

  // Propiedad para recibir datos desde el modal
  gananciasPendientes: GananciasPendientes | null = null;

  notificaciones: any[] = [];

  ngOnInit() {
    // Construir notificaciones dinámicas
    if (this.gananciasPendientes) {
      this.notificaciones.push({
        id: 'ganancias-' + this.gananciasPendientes.mes,
        tipo: 'GANANCIAS_MENSUALES',
        titulo: 'Transferir ganancias',
        mensaje: this.gananciasPendientes.mesDisplay,
        detalle: `Celular: $${this.gananciasPendientes.gananciaCelular.toFixed(2)} | Bus: $${this.gananciasPendientes.gananciaBus.toFixed(2)} | Total: $${this.gananciasPendientes.total.toFixed(2)}`,
        icono: 'cash-outline',
        color: 'success'
      });
    }
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }

  async accionarNotificacion(notif: any) {
    // Cerrar modal primero
    await this.modalCtrl.dismiss({ reload: false });

    // Navegar a página de transferencia
    if (notif.tipo === 'GANANCIAS_MENSUALES') {
      await this.router.navigate(['/home/transferir-ganancias'], {
        state: { ganancias: this.gananciasPendientes }
      });
    }
  }
}
