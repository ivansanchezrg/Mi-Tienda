import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
  IonContent, IonIcon,
  IonRefresher, IonRefresherContent, IonSkeletonText,
  ModalController, AlertController
} from '@ionic/angular/standalone';
import { ROUTES } from '@core/config/routes.config';
import { addIcons } from 'ionicons';
import {
  phonePortraitOutline, busOutline,
  chevronForwardOutline, timeOutline,
  walletOutline, informationCircleOutline,
  cardOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { ConfigService } from '@core/services/config.service';
import { SupabaseService } from '@core/services/supabase.service';
import { RecargasVirtualesService, RecargaVirtual } from '../../services/recargas-virtuales.service';
import { RegistrarRecargaModalComponent } from '../../components/registrar-recarga-modal/registrar-recarga-modal.component';
import { HistorialModalComponent } from '../../components/historial-modal/historial-modal.component';
import { PagarProveedorModalComponent } from '../../components/pagar-proveedor-modal/pagar-proveedor-modal.component';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';

type TabActivo = 'CELULAR' | 'BUS';

@Component({
  selector: 'app-recargas-virtuales',
  templateUrl: './recargas-virtuales.page.html',
  styleUrls: ['./recargas-virtuales.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
    IonContent, IonIcon,
    IonRefresher, IonRefresherContent, IonSkeletonText,
    AppCurrencyPipe,
  ]
})
export class RecargasVirtualesPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private ui = inject(UiService);
  private supabase = inject(SupabaseService);
  private configService = inject(ConfigService);
  private service = inject(RecargasVirtualesService);
  private modalCtrl = inject(ModalController);
  private alertCtrl = inject(AlertController);

  tabActivo: TabActivo = 'CELULAR';
  loading = true;
  recargasCelularHabilitada = false;
  recargasBusHabilitada = false;
  cajaVariosActiva = false;

  // CELULAR
  saldoVirtualCelular = 0;
  cajaCelularSaldo = 0;
  pendientesCelular: RecargaVirtual[] = [];   // para liquidar (pagado_proveedor=true)
  deudasCelular: RecargaVirtual[] = [];       // para pagar al proveedor (pagado_proveedor=false)
  totalMovimientosCelular = 0;

  // BUS
  saldoVirtualBus = 0;
  cajaBusSaldo = 0;
  pendientesBus: RecargaVirtual[] = [];
  totalMovimientosBus = 0;

  constructor() {
    addIcons({
      phonePortraitOutline,
      busOutline,
      chevronForwardOutline,
      timeOutline,
      walletOutline,
      informationCircleOutline,
      cardOutline,
    });
  }

  async ionViewWillEnter() {
    this.ui.hideTabs();

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
    try {
      const loadCelular = this.recargasCelularHabilitada;
      const loadBus     = this.recargasBusHabilitada;

      const [
        saldoCelular, saldoBus,
        pendientesCelular, pendientesBus,
        deudasCelular,
        cajaCelular, cajaBus,
        historialCelular, historialBus,
      ] = await Promise.all([
        loadCelular ? this.service.getSaldoVirtualActual('CELULAR')   : Promise.resolve(0),
        loadBus     ? this.service.getSaldoVirtualActual('BUS')       : Promise.resolve(0),
        loadCelular ? this.service.obtenerPendientes('CELULAR')       : Promise.resolve([] as RecargaVirtual[]),
        loadBus     ? this.service.obtenerPendientes('BUS')           : Promise.resolve([] as RecargaVirtual[]),
        loadCelular ? this.service.obtenerDeudasCelular()             : Promise.resolve([] as RecargaVirtual[]),
        loadCelular ? this.service.getSaldoCajaActual('CAJA_CELULAR') : Promise.resolve(0),
        loadBus     ? this.service.getSaldoCajaActual('CAJA_BUS')     : Promise.resolve(0),
        loadCelular ? this.service.obtenerHistorial('CELULAR')        : Promise.resolve([] as RecargaVirtual[]),
        loadBus     ? this.service.obtenerHistorial('BUS')            : Promise.resolve([] as RecargaVirtual[]),
      ]);

      this.saldoVirtualCelular     = saldoCelular;
      this.saldoVirtualBus         = saldoBus;
      this.pendientesCelular       = pendientesCelular;
      this.pendientesBus           = pendientesBus;
      this.deudasCelular           = deudasCelular;
      this.cajaCelularSaldo        = cajaCelular;
      this.cajaBusSaldo            = cajaBus;
      this.totalMovimientosCelular = historialCelular.length;
      this.totalMovimientosBus     = historialBus.length;
    } catch (error) {
      if (!this.supabase.debeSilenciarErrorOffline(error)) {
        await this.ui.showError('Error al cargar los datos');
      }
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

  get totalDeudaCelular(): number {
    return Math.round(this.deudasCelular.reduce((s, r) => s + r.monto_a_pagar, 0) * 100) / 100;
  }

  get gananciaCelularPendiente(): number {
    return Math.round(this.pendientesCelular.reduce((s, r) => s + r.ganancia, 0) * 100) / 100;
  }

  get gananciasBusPendiente(): number {
    return Math.round(this.pendientesBus.reduce((s, r) => s + r.ganancia, 0) * 100) / 100;
  }

  // ==========================================
  // ACCIONES
  // ==========================================

  async abrirModalPagarProveedor() {
    const modal = await this.modalCtrl.create({
      component: PagarProveedorModalComponent,
      componentProps: {
        deudas: this.deudasCelular,
        cajaCelularSaldo: this.cajaCelularSaldo,
      }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.success) await this.cargarDatos();
  }

  async abrirModalRecarga() {
    const modal = await this.modalCtrl.create({
      component: RegistrarRecargaModalComponent,
      componentProps: { tipo: 'CELULAR' }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.success) await this.cargarDatos();
  }

  async abrirModalCompraBus() {
    if (this.cajaBusSaldo <= 0) {
      const alert = await this.alertCtrl.create({
        header: 'Caja Bus sin efectivo',
        message: 'Para registrar un depósito necesitas tener efectivo en Caja Bus. Primero registra un ingreso manual desde la pantalla de inicio.',
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          { text: 'Ir a Caja', handler: () => { this.router.navigate([ROUTES.home]); } }
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
    if (data?.success) await this.cargarDatos();
  }

  async abrirHistorial(tipo: TabActivo) {
    const esCelular = tipo === 'CELULAR';
    const modal = await this.modalCtrl.create({
      component: HistorialModalComponent,
      componentProps: {
        tipo,
        cajaSaldo:        esCelular ? this.cajaCelularSaldo : this.cajaBusSaldo,
        cajaVariosActiva: this.cajaVariosActiva,
        pendientes:       esCelular ? this.pendientesCelular : this.pendientesBus,
      }
    });
    await modal.present();
    // Siempre recarga al cerrar — el modal pudo cambiar el estado del negocio (pagar
    // al proveedor desde otra pantalla mientras estaba abierto, etc.), no solo cuando
    // confirma la liquidación. Garantiza que la próxima apertura reciba @Input frescos.
    await modal.onWillDismiss();
    await this.cargarDatos();
  }

  // ==========================================
  // HELPERS
  // ==========================================

  async handleRefresh(event: CustomEvent) {
    await this.cargarDatos(true);
    (event.target as HTMLIonRefresherElement).complete();
  }
}
