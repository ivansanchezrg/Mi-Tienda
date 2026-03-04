import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
  IonContent, IonIcon,
  IonRefresher, IonRefresherContent,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  phonePortraitOutline, busOutline,
  cashOutline, checkmarkCircleOutline, alertCircleOutline,
  listOutline, chevronBackOutline, trendingUpOutline, lockClosedOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
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
    IonRefresher, IonRefresherContent,
  ]
})
export class RecargasVirtualesPage implements OnInit {
  private route = inject(ActivatedRoute);
  private ui = inject(UiService);
  private service = inject(RecargasVirtualesService);
  private gananciasService = inject(GananciasService);
  private modalCtrl = inject(ModalController);

  tabActivo: TabActivo = 'CELULAR';

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

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      if (params['tab']) {
        this.tabActivo = params['tab'] as TabActivo;
      }
    });
  }

  ionViewWillEnter() {
    this.ui.hideTabs();
    this.cargarDatos();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
    this.tabActivo = 'CELULAR';
  }

  async cargarDatos() {
    try {
      const [saldoCelular, saldoBus, deudas, gananciasPendientes, gananciaMesActual] = await Promise.all([
        this.service.getSaldoVirtualActual('CELULAR'),
        this.service.getSaldoVirtualActual('BUS'),
        this.service.obtenerDeudasPendientesCelular(),
        this.gananciasService.verificarGananciasPendientes(),
        this.gananciasService.calcularGananciaBusMesActual()
      ]);
      this.saldoVirtualCelular = saldoCelular;
      this.saldoVirtualBus = saldoBus;
      this.deudasPendientes = deudas;
      this.gananciaBusMesAnterior = gananciasPendientes?.gananciaBus ?? 0;
      this.gananciaBusMesActual = gananciaMesActual;
    } catch {
      await this.ui.showError('Error al cargar los datos');
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
      componentProps: { tipo: 'CELULAR' },
      breakpoints: [0, 1],
      initialBreakpoint: 1
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
      componentProps: { tipo: 'BUS' },
      breakpoints: [0, 1],
      initialBreakpoint: 1
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
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1
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
      component: PagarDeudasModalComponent,
      breakpoints: [0, 1],
      initialBreakpoint: 1
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
      componentProps: { tipo: this.tabActivo },
      breakpoints: [0, 1],
      initialBreakpoint: 1
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
    event.target.complete(); // Cierra el spinner del refresher de inmediato
    await this.cargarDatos(); // El overlay de cargarDatos() ya informa el estado
  }

}

