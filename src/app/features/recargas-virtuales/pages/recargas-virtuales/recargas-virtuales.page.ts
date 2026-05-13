import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
  IonContent, IonIcon, IonButton,
  IonRefresher, IonRefresherContent, IonSkeletonText,
  ModalController, AlertController
} from '@ionic/angular/standalone';
import { ROUTES } from '@core/config/routes.config';
import { addIcons } from 'ionicons';
import {
  phonePortraitOutline, busOutline,
  cashOutline, checkmarkCircleOutline,
  chevronForwardOutline, lockClosedOutline,
  walletOutline, informationCircleOutline, chevronDownOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { ConfigService } from '@core/services/config.service';
import { AuthService } from '../../../auth/services/auth.service';
import { RecargasVirtualesService, RecargaVirtual } from '../../services/recargas-virtuales.service';
import { RegistrarRecargaModalComponent } from '../../components/registrar-recarga-modal/registrar-recarga-modal.component';
import { HistorialModalComponent } from '../../components/historial-modal/historial-modal.component';

type TabActivo = 'CELULAR' | 'BUS';

@Component({
  selector: 'app-recargas-virtuales',
  templateUrl: './recargas-virtuales.page.html',
  styleUrls: ['./recargas-virtuales.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
    IonContent, IonIcon, IonButton,
    IonRefresher, IonRefresherContent, IonSkeletonText
  ]
})
export class RecargasVirtualesPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private ui = inject(UiService);
  private configService = inject(ConfigService);
  private authService = inject(AuthService);
  private service = inject(RecargasVirtualesService);
  private modalCtrl = inject(ModalController);
  private alertCtrl = inject(AlertController);

  tabActivo: TabActivo = 'CELULAR';
  loading = true;
  esSuperadmin = false;
  recargasCelularHabilitada = false;
  recargasBusHabilitada = false;
  cajaVariosActiva = false;

  // CELULAR
  saldoVirtualCelular = 0;
  cajaCelularSaldo = 0;
  /** Filas CELULAR pendientes de liquidar (pagado_proveedor=false) */
  pendientesCelular: RecargaVirtual[] = [];
  ultimasRecargasCelular: RecargaVirtual[] = [];

  // BUS
  saldoVirtualBus = 0;
  cajaBusSaldo = 0;
  /** Filas BUS pendientes de liquidar (pagado_proveedor=false) */
  pendientesBus: RecargaVirtual[] = [];
  ultimasRecargasBus: RecargaVirtual[] = [];

  // Estado acordeón
  liquidacionCelularExpandida = false;
  liquidacionBusExpandida = false;

  constructor() {
    addIcons({
      phonePortraitOutline,
      busOutline,
      cashOutline,
      checkmarkCircleOutline,
      chevronForwardOutline,
      chevronDownOutline,
      lockClosedOutline,
      walletOutline,
      informationCircleOutline,
    });
  }

  async ionViewWillEnter() {
    this.ui.hideTabs();
    const usuario = await this.authService.getUsuarioActual();
    this.esSuperadmin = usuario?.es_superadmin ?? false;

    const config = await this.configService.get();
    this.recargasCelularHabilitada = config?.recargas_celular_habilitada ?? false;
    this.recargasBusHabilitada     = config?.recargas_bus_habilitada     ?? false;
    this.cajaVariosActiva          = config?.caja_varios_activa          ?? false;

    if (!this.recargasCelularHabilitada && this.recargasBusHabilitada) {
      this.tabActivo = 'BUS';
    } else {
      this.tabActivo = 'CELULAR';
    }

    const params = this.route.snapshot.queryParams;
    if (params['tab']) {
      this.tabActivo = params['tab'] as TabActivo;
    }

    this.cargarDatos();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  async cargarDatos(isRefresh = false) {
    if (!isRefresh) this.loading = true;
    this.liquidacionCelularExpandida = false;
    this.liquidacionBusExpandida = false;
    try {
      const loadCelular = this.recargasCelularHabilitada;
      const loadBus     = this.recargasBusHabilitada;

      const [
        saldoCelular, saldoBus,
        pendientesCelular, pendientesBus,
        cajaCelular, cajaBus,
        historialCelular, historialBus,
      ] = await Promise.all([
        loadCelular ? this.service.getSaldoVirtualActual('CELULAR')  : Promise.resolve(0),
        loadBus     ? this.service.getSaldoVirtualActual('BUS')      : Promise.resolve(0),
        loadCelular ? this.service.obtenerPendientes('CELULAR')      : Promise.resolve([] as RecargaVirtual[]),
        loadBus     ? this.service.obtenerPendientes('BUS')          : Promise.resolve([] as RecargaVirtual[]),
        loadCelular ? this.service.getSaldoCajaActual('CAJA_CELULAR'): Promise.resolve(0),
        loadBus     ? this.service.getSaldoCajaActual('CAJA_BUS')    : Promise.resolve(0),
        loadCelular ? this.service.obtenerHistorial('CELULAR')       : Promise.resolve([] as RecargaVirtual[]),
        loadBus     ? this.service.obtenerHistorial('BUS')           : Promise.resolve([] as RecargaVirtual[]),
      ]);

      this.saldoVirtualCelular  = saldoCelular;
      this.saldoVirtualBus      = saldoBus;
      this.pendientesCelular    = pendientesCelular;
      this.pendientesBus        = pendientesBus;
      this.cajaCelularSaldo     = cajaCelular;
      this.cajaBusSaldo         = cajaBus;
      this.ultimasRecargasCelular = historialCelular.slice(0, 3);
      this.ultimasRecargasBus     = historialBus.slice(0, 3);
    } catch {
      await this.ui.showError('Error al cargar los datos');
    } finally {
      this.loading = false;
    }
  }

  cambiarTab(tab: TabActivo) {
    this.tabActivo = tab;
  }

  // ==========================================
  // GETTERS
  // ==========================================

  get nombreCajaDestino(): string {
    return this.cajaVariosActiva ? 'Varios' : 'Tienda';
  }

  get gananciaCelularPendiente(): number {
    return Math.round(this.pendientesCelular.reduce((s, r) => s + r.ganancia, 0) * 100) / 100;
  }

  get gananciasBusPendiente(): number {
    return Math.round(this.pendientesBus.reduce((s, r) => s + r.ganancia, 0) * 100) / 100;
  }

  get celularPuedeLiquidar(): boolean {
    return this.gananciaCelularPendiente > 0
        && this.cajaCelularSaldo >= this.gananciaCelularPendiente;
  }

  get celularBloqueadoPorSaldo(): boolean {
    return this.gananciaCelularPendiente > 0
        && this.cajaCelularSaldo < this.gananciaCelularPendiente;
  }

  get busPuedeLiquidar(): boolean {
    return this.gananciasBusPendiente > 0
        && this.cajaBusSaldo >= this.gananciasBusPendiente;
  }

  get busBloqueadoPorSaldo(): boolean {
    return this.gananciasBusPendiente > 0
        && this.cajaBusSaldo < this.gananciasBusPendiente;
  }

  // ==========================================
  // ACORDEÓN
  // ==========================================

  toggleLiquidacionCelular() {
    this.liquidacionCelularExpandida = !this.liquidacionCelularExpandida;
  }

  toggleLiquidacionBus() {
    this.liquidacionBusExpandida = !this.liquidacionBusExpandida;
  }

  // ==========================================
  // ACCIONES
  // ==========================================

  async abrirModalRecarga() {
    const modal = await this.modalCtrl.create({
      component: RegistrarRecargaModalComponent,
      componentProps: { tipo: 'CELULAR' }
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (data?.success) {
      await this.cargarDatos();
    }
  }

  async abrirModalCompraBus() {
    if (this.cajaBusSaldo <= 0) {
      const alert = await this.alertCtrl.create({
        header: 'Caja Bus sin efectivo',
        message: 'Para registrar un depósito necesitas tener efectivo en Caja Bus. Primero registra un ingreso manual desde la pantalla de inicio.',
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          {
            text: 'Ir a Caja',
            handler: () => { this.router.navigate([ROUTES.home]); }
          }
        ]
      });
      await alert.present();
      return;
    }

    const modal = await this.modalCtrl.create({
      component: RegistrarRecargaModalComponent,
      componentProps: { tipo: 'BUS' }
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (data?.success) {
      await this.cargarDatos();
    }
  }

  async abrirHistorial() {
    const modal = await this.modalCtrl.create({
      component: HistorialModalComponent,
      componentProps: { tipo: this.tabActivo }
    });

    await modal.present();
  }

  // ==========================================
  // LIQUIDACIÓN
  // ==========================================

  async confirmarLiquidacion(servicio: 'CELULAR' | 'BUS') {
    const esCelular = servicio === 'CELULAR';
    const monto = esCelular ? this.gananciaCelularPendiente : this.gananciasBusPendiente;
    const nombreCaja = esCelular ? 'Caja Celular' : 'Caja Bus';

    const alert = await this.alertCtrl.create({
      header: `Liquidar ganancia ${esCelular ? 'Celular' : 'Bus'}`,
      message: `Vas a transferir $${monto.toFixed(2)} de ${nombreCaja} a ${this.nombreCajaDestino}.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Confirmar',
          handler: () => { this.ejecutarLiquidacion(servicio); }
        }
      ]
    });
    await alert.present();
  }

  private async ejecutarLiquidacion(servicio: 'CELULAR' | 'BUS') {
    const empleado = await this.authService.getUsuarioActual();
    if (!empleado) {
      await this.ui.showError('No se pudo obtener el empleado');
      return;
    }
    try {
      const resultado = await this.service.liquidarGanancias(servicio, empleado.id);
      await this.ui.showSuccess(resultado.message);
      await this.cargarDatos();
    } catch (err: any) {
      await this.ui.showError(err?.message ?? 'Error al liquidar la ganancia');
    }
  }

  async explicarLiquidacionSinSaldoCelular() {
    await this.ui.showToast(
      `Caja Celular tiene $${this.cajaCelularSaldo.toFixed(2)} y necesitas $${this.gananciaCelularPendiente.toFixed(2)}. Vende más recargas para acumular el efectivo.`,
      'warning'
    );
  }

  async explicarLiquidacionSinSaldoBus() {
    await this.ui.showToast(
      `Caja Bus tiene $${this.cajaBusSaldo.toFixed(2)} y necesitas $${this.gananciasBusPendiente.toFixed(2)}. Vende más pasajes para acumular el efectivo.`,
      'warning'
    );
  }

  // ==========================================
  // HELPERS
  // ==========================================

  formatearFecha(fecha: string): string {
    const d = new Date(fecha + 'T00:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  async handleRefresh(event: CustomEvent) {
    await this.cargarDatos(true);
    (event.target as HTMLIonRefresherElement).complete();
  }
}
