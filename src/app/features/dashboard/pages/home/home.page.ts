import { Component, inject, OnInit, ChangeDetectorRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton, IonRefresher, IonRefresherContent,
  IonCard, IonIcon, IonBadge, IonButton, ModalController,
  IonList, IonItem, IonLabel, IonText, IonCheckbox, ToastController, ActionSheetController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  walletOutline, cashOutline, phonePortraitOutline, busOutline,
  chevronForwardOutline, chevronDownOutline, checkmarkCircle, closeCircle,
  arrowDownOutline, arrowUpOutline, swapHorizontalOutline,
  receiptOutline, clipboardOutline, notificationsOutline, close,
  notificationsOffOutline, cloudOfflineOutline, alertCircleOutline,
  ellipsisVertical, listOutline, lockOpenOutline, lockClosedOutline,
  timeOutline, playOutline, stopOutline
} from 'ionicons/icons';
import { ScrollablePage } from '@core/pages/scrollable.page';
import { UiService } from '@core/services/ui.service';
import { NetworkService } from '@core/services/network.service';
import { RecargasService } from '../../services/recargas.service';
import { CajasService, Caja } from '../../services/cajas.service';
import { OperacionesCajaService } from '../../services/operaciones-caja.service';
import { AuthService } from '../../../auth/services/auth.service';
import { GananciasService, GananciasPendientes } from '../../services/ganancias.service';
import { TurnosCajaService } from '../../services/turnos-caja.service';
import { EstadoCaja } from '../../models/turno-caja.model';
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
  private turnosCajaService = inject(TurnosCajaService);
  private modalCtrl = inject(ModalController);
  private toastCtrl = inject(ToastController);
  private actionSheetCtrl = inject(ActionSheetController);
  private networkService = inject(NetworkService);
  private cdr = inject(ChangeDetectorRef);

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
      ellipsisVertical, listOutline, lockOpenOutline, lockClosedOutline,
      timeOutline, playOutline, stopOutline
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
   * Detecta acciones desde el FAB (ej: action=gasto)
   */
  override async ionViewWillEnter(): Promise<void> {
    super.ionViewWillEnter();

    // Check for action from FAB
    const action = this.route.snapshot.queryParams['action'];

    // Check if should refresh (coming from cierre or other process)
    const refresh = this.route.snapshot.queryParams['refresh'];

    if (action || refresh) {
      // Clear query params first to avoid loops
      await this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true
      });

      // Handle action
      if (action === 'gasto') {
        await this.onOperacion('gasto');
      }

      // Refresh data if needed
      if (refresh) {
        await this.cargarDatos();
      }
    }
  }

  /**
   * Carga el estado de la caja y todos los datos necesarios (Versión 2.0)
   * Todas las consultas en paralelo para un solo loading
   * NOTA: En v2.0, la apertura es implícita (ausencia de cierre para hoy)
   */
  async cargarDatos() {
    // Ejecutar todas las consultas en paralelo (un solo loading)
    const [estadoCaja, saldos, fechaUltimoCierre, gananciasPendientes] = await Promise.all([
      this.turnosCajaService.obtenerEstadoCaja(),
      this.cajasService.obtenerSaldosCajas(),
      this.cajasService.obtenerFechaUltimoCierre(),
      this.gananciasService.verificarGananciasPendientes()
    ]);

    // Asignar estado de caja (crear nuevo objeto para forzar detección de cambios)
    this.estadoCaja = { ...estadoCaja };

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
    // Mapear 'gasto' a 'egreso'
    if (tipo === 'gasto') {
      tipo = 'egreso';
    }

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

  async onAbrirCaja() {
    // Mostrar modal de verificación de fondo fijo
    const confirmado = await this.mostrarModalVerificacionFondo();
    if (!confirmado) return;

    // Si confirma, abrir turno
    const success = await this.turnosCajaService.abrirTurno();

    if (success) {
      // Dar tiempo a que la BD se actualice
      await new Promise(resolve => setTimeout(resolve, 300));

      // Recargar datos
      await this.cargarDatos();

      // Forzar detección de cambios
      this.cdr.detectChanges();
    }
  }

  /**
   * Cierra la caja y navega al proceso de cierre contable completo
   * Este método reemplaza el anterior "Cerrar Día" de operaciones
   */
  async onCerrarCaja() {
    // Verificar que haya turno activo
    if (!this.estadoCaja.turnoActivo) return;

    // Navegar a la página de cierre diario (igual que antes)
    await this.onCerrarDia();
  }

  onCuadre() {
    this.router.navigate(['/home/cuadre-caja']);
  }

  /**
   * Navega a la página de cierre diario
   * Verifica:
   * 1. Que haya un turno abierto (validación de turno)
   * 2. Que no exista un cierre para hoy (validación de cierre)
   */
  async onCerrarDia() {
    // VALIDACIÓN 1: Verificar que haya turno abierto
    if (this.estadoCaja.estado !== 'TURNO_EN_CURSO') {
      const toast = await this.toastCtrl.create({
        message: 'Debes abrir la caja primero antes de hacer el cierre diario',
        duration: 3000,
        color: 'warning',
        position: 'top',
        icon: 'alert-circle-outline'
      });
      await toast.present();
      return;
    }

    // VALIDACIÓN 2: Verificar que no exista cierre para hoy
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

    // Si pasa todas las validaciones, navegar a la página de cierre diario
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

  async mostrarModalVerificacionFondo(): Promise<boolean> {
    const fondoFijo = await this.turnosCajaService.obtenerFondoFijo();

    const modal = await this.modalCtrl.create({
      component: VerificarFondoModalComponent,
      cssClass: 'verificar-fondo-modal',
      componentProps: {
        fondoFijo
      }
    });

    await modal.present();
    const { data, role } = await modal.onWillDismiss();
    return role === 'confirm' && data?.confirmado === true;
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

// ==========================================
// COMPONENTE MODAL DE VERIFICACIÓN DE FONDO
// ==========================================

@Component({
  selector: 'app-verificar-fondo-modal',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Abrir Caja</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="cancelar()">
            <ion-icon slot="icon-only" name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-card class="verificar-card">
        <div class="verificacion-content">
          <div class="info-section">
            <div class="info-row">
              <ion-icon name="cash-outline" color="success"></ion-icon>
              <div class="info-text">
                <div class="info-label">Fondo fijo inicial</div>
                <div class="info-value">\${{ fondoFijo | number:'1.2-2' }}</div>
              </div>
            </div>
            <p class="info-descripcion">
              Confirma que este monto está en la caja física antes de continuar.
            </p>
          </div>

          <div class="checkbox-section">
            <ion-checkbox [(ngModel)]="confirmado" labelPlacement="end">
              He verificado el fondo en la caja
            </ion-checkbox>
          </div>

          <div class="actions-section">
            <ion-button
              expand="block"
              color="success"
              [disabled]="!confirmado"
              (click)="abrirCaja()"
              style="--border-radius: 8px">
              Abrir Caja
            </ion-button>
            <ion-button
              expand="block"
              fill="clear"
              color="medium"
              (click)="cancelar()">
              Cancelar
            </ion-button>
          </div>
        </div>
      </ion-card>
    </ion-content>
  `,
  styles: [`
    ion-content {
      --padding-top: 8px;
      --padding-bottom: 8px;
    }

    .verificar-card {
      margin: 0;
      border-radius: 16px;
      box-shadow: none;
    }

    .verificacion-content {
      display: flex;
      flex-direction: column;
      gap: 20px;
      padding: 20px;

      .info-section {
        .info-row {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 12px;
          padding: 20px;
          background: var(--ion-color-light);
          border-radius: 12px;
          margin-bottom: 12px;

          ion-icon {
            font-size: 32px;
            flex-shrink: 0;
          }

          .info-text {
            .info-label {
              font-size: 13px;
              color: var(--ion-color-medium);
              margin-bottom: 4px;
            }

            .info-value {
              font-size: 28px;
              font-weight: 700;
              color: var(--ion-color-success);
            }
          }
        }

        .info-descripcion {
          font-size: 13px;
          color: var(--ion-color-medium);
          line-height: 1.4;
          margin: 0;
          text-align: center;
        }
      }

      .checkbox-section {
        ion-checkbox {
          --size: 20px;
          width: 100%;
        }
      }

      .actions-section {
        display: flex;
        flex-direction: column;
        gap: 8px;

        ion-button {
          margin: 0;
        }
      }
    }
  `],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonCard, IonIcon, IonCheckbox
  ]
})
export class VerificarFondoModalComponent {
  private modalCtrl = inject(ModalController);

  fondoFijo = 40.00;
  confirmado = false;

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  abrirCaja() {
    this.modalCtrl.dismiss({ confirmado: true }, 'confirm');
  }
}
