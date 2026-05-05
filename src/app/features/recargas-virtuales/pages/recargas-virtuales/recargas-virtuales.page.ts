import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
  IonContent, IonIcon,
  IonRefresher, IonRefresherContent, IonSkeletonText,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  phonePortraitOutline, busOutline,
  cashOutline, checkmarkCircleOutline, alertCircleOutline,
  listOutline, chevronBackOutline, trendingUpOutline, lockClosedOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { ConfigService } from '@core/services/config.service';
import { RecargasVirtualesService, RecargaVirtual } from '@core/services/recargas-virtuales.service';
import { GananciasService } from '@core/services/ganancias.service';
import { RegistrarRecargaModalComponent } from '../../components/registrar-recarga-modal/registrar-recarga-modal.component';
import { PagarDeudasModalComponent } from '../../components/pagar-deudas-modal/pagar-deudas-modal.component';
import { HistorialModalComponent } from '../../components/historial-modal/historial-modal.component';
import { LiquidacionBusModalComponent } from '../../components/liquidacion-bus-modal/liquidacion-bus-modal.component';

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
    IonRefresher, IonRefresherContent, IonSkeletonText
  ]
})
export class RecargasVirtualesPage {
  private route = inject(ActivatedRoute);
  private ui = inject(UiService);
  private configService = inject(ConfigService);
  private service = inject(RecargasVirtualesService);
  private gananciasService = inject(GananciasService);
  private modalCtrl = inject(ModalController);

  tabActivo: TabActivo = 'CELULAR';
  loading = true;
  recargasCelularHabilitada = false;
  recargasBusHabilitada = false;

  // CELULAR
  saldoVirtualCelular = 0;
  deudasPendientes: RecargaVirtual[] = [];

  // BUS
  saldoVirtualBus = 0;
  gananciaBusMesAnterior = 0;  // ganancia mes anterior sin liquidar → muestra botón de liquidación
  gananciaBusMesActual = 0;    // ganancia acumulada mes en curso → solo informativa

  constructor() {
    addIcons({
      phonePortraitOutline,
      busOutline,
      cashOutline,
      checkmarkCircleOutline,
      alertCircleOutline,
      listOutline,
      chevronBackOutline,
      trendingUpOutline,
      lockClosedOutline
    });
  }

  async ionViewWillEnter() {
    this.ui.hideTabs();
    const config = await this.configService.get();
    this.recargasCelularHabilitada = config?.recargas_celular_habilitada ?? false;
    this.recargasBusHabilitada     = config?.recargas_bus_habilitada ?? false;

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
    if (!isRefresh) {
      this.loading = true;
    }
    try {
      const loadCelular = this.recargasCelularHabilitada;
      const loadBus     = this.recargasBusHabilitada;

      const [saldoCelular, saldoBus, deudas, gananciasPendientes, gananciaMesActual] = await Promise.all([
        loadCelular ? this.service.getSaldoVirtualActual('CELULAR')        : Promise.resolve(0),
        loadBus     ? this.service.getSaldoVirtualActual('BUS')            : Promise.resolve(0),
        loadCelular ? this.service.obtenerDeudasPendientesCelular()        : Promise.resolve([]),
        loadBus     ? this.gananciasService.verificarGananciasPendientes() : Promise.resolve(null),
        loadBus     ? this.gananciasService.calcularGananciaBusMesActual() : Promise.resolve(0),
      ]);
      this.saldoVirtualCelular    = saldoCelular;
      this.saldoVirtualBus        = saldoBus;
      this.deudasPendientes       = deudas;
      this.gananciaBusMesAnterior = gananciasPendientes?.gananciaBus ?? 0;
      this.gananciaBusMesActual   = gananciaMesActual;
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
  // MODAL: Registrar Recarga
  // ==========================================

  async abrirModalRecarga() {
    const modal = await this.modalCtrl.create({
      component: RegistrarRecargaModalComponent,
      componentProps: { tipo: 'CELULAR' }
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (data?.success && data?.data) {
      // El RPC ya devuelve todo lo necesario. BUS/ganancia no cambian
      // con una recarga CELULAR → sin queries adicionales ni segundo loading.
      const resultado = data.data;
      this.saldoVirtualCelular = resultado.saldo_virtual_celular;
      this.deudasPendientes = resultado.deudas_pendientes.lista;
    } else if (data?.success) {
      // Fallback: si no vienen datos completos, recargar todo
      await this.cargarDatos();
    }
  }

  async abrirModalCompraBus() {
    const modal = await this.modalCtrl.create({
      component: RegistrarRecargaModalComponent,
      componentProps: { tipo: 'BUS' }
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (data?.success) {
      // Actualiza saldo BUS y ganancia acumulada del mes en paralelo.
      // getSaldoVirtualActual usa supabase.client (silencioso).
      // calcularGananciaBusMesActual usa supabase.call (muestra overlay brevemente).
      const [saldoBus, gananciaMesActual] = await Promise.all([
        this.service.getSaldoVirtualActual('BUS'),
        this.gananciasService.calcularGananciaBusMesActual()
      ]);
      this.saldoVirtualBus = saldoBus;
      this.gananciaBusMesActual = gananciaMesActual;
    }
  }

  async abrirModalLiquidacionBus() {
    const modal = await this.modalCtrl.create({
      component: LiquidacionBusModalComponent,
      componentProps: {
        gananciaBusCalculada: this.gananciaBusMesAnterior,
        mesDisplay: this.gananciasService.getMesAnteriorDisplay(),
        mesAnterior: this.gananciasService.getMesAnterior()
      }
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (data?.success) {
      await this.cargarDatos();
    }
  }

  // ==========================================
  // MODAL: Pagar Deudas
  // ==========================================

  async navegarAPagarDeudas() {
    const modal = await this.modalCtrl.create({
      component: PagarDeudasModalComponent
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (data?.success) {
      await this.cargarDatos();
    }
  }

  // ==========================================
  // MODAL: Ver Historial
  // ==========================================

  async abrirHistorial() {
    const modal = await this.modalCtrl.create({
      component: HistorialModalComponent,
      componentProps: { tipo: this.tabActivo }
    });

    await modal.present();
  }

  // ==========================================
  // GETTERS: Deudas pendientes
  // ==========================================

  /** "1 de Abril 2026" — fecha desde la que se podrá liquidar la ganancia del mes actual */
  get proximoMesDisplay(): string {
    const hoy = new Date();
    const primerDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
    const nombreMes = primerDia.toLocaleDateString('es-ES', { month: 'long' });
    const capitalizado = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
    return `1 de ${capitalizado} ${primerDia.getFullYear()}`;
  }

  get cantidadDeudasPendientes(): number {
    return this.deudasPendientes.length;
  }

  get totalDeudasPendientes(): number {
    return this.deudasPendientes.reduce((sum, d) => sum + d.monto_a_pagar, 0);
  }

  // ==========================================
  // HELPERS
  // ==========================================

  formatearFecha(fecha: string): string {
    const d = new Date(fecha + 'T00:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  async handleRefresh(event: any) {
    await this.cargarDatos(true);
    event.target.complete();
  }

}

