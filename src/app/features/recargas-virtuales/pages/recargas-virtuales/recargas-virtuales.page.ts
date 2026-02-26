import { Component, inject, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonSpinner,
  IonRefresher, IonRefresherContent,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chevronBackOutline, phonePortraitOutline, busOutline,
  cashOutline, checkmarkCircleOutline, alertCircleOutline,
  listOutline
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
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonSpinner,
    IonRefresher, IonRefresherContent,
  ]
})
export class RecargasVirtualesPage implements OnInit {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private ui = inject(UiService);
  private service = inject(RecargasVirtualesService);
  private gananciasService = inject(GananciasService);
  private modalCtrl = inject(ModalController);

  tabActivo: TabActivo = 'CELULAR';
  loading = true;

  // CELULAR
  saldoVirtualCelular = 0;
  deudasPendientes: RecargaVirtual[] = [];

  // BUS
  saldoVirtualBus = 0;
  gananciaBusCalculada = 0;  // SUM ganancia BUS mes anterior para mostrar botón de liquidación

  constructor() {
    addIcons({
      chevronBackOutline,
      phonePortraitOutline,
      busOutline,
      cashOutline,
      checkmarkCircleOutline,
      alertCircleOutline,
      listOutline
    });
  }

  async ngOnInit() {
    await this.cargarDatos();

    // Soporte para refresh al volver
    this.route.queryParams.subscribe(params => {
      if (params['refresh']) {
        this.cargarDatos();
      }
    });
  }

  ionViewWillEnter() {
    this.ui.hideTabs();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  async cargarDatos() {
    this.loading = true;
    try {
      const [saldoCelular, saldoBus, deudas, gananciaBus] = await Promise.all([
        this.service.getSaldoVirtualActual('CELULAR'),
        this.service.getSaldoVirtualActual('BUS'),
        this.service.obtenerDeudasPendientesCelular(),
        this.gananciasService.calcularGananciaBusMesAnterior()
      ]);
      this.saldoVirtualCelular = saldoCelular;
      this.saldoVirtualBus = saldoBus;
      this.deudasPendientes = deudas;
      this.gananciaBusCalculada = gananciaBus;
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
      // Usar datos del resultado (SIN queries adicionales para CELULAR)
      const resultado = data.data;

      // Actualizar UI con datos del resultado
      this.saldoVirtualCelular = resultado.saldo_virtual_celular;
      this.deudasPendientes = resultado.deudas_pendientes.lista;

      // Solo recargar datos de BUS y ganancia (no relacionados con esta operación)
      this.loading = true;
      try {
        const [saldoBus, gananciaBus] = await Promise.all([
          this.service.getSaldoVirtualActual('BUS'),
          this.gananciasService.calcularGananciaBusMesAnterior()
        ]);

        this.saldoVirtualBus = saldoBus;
        this.gananciaBusCalculada = gananciaBus;
      } catch {
        await this.ui.showError('Error al actualizar los datos');
      } finally {
        this.loading = false;
      }
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
      await this.cargarDatos();
    }
  }

  async abrirModalLiquidacionBus() {
    const modal = await this.modalCtrl.create({
      component: LiquidacionBusModalComponent,
      componentProps: {
        gananciaBusCalculada: this.gananciaBusCalculada,
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
    await this.cargarDatos();
    event.target.complete();
  }

  volver() {
    this.router.navigate(['/home']);
  }
}

