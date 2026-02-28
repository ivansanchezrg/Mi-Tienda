import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton, IonButton, IonIcon, IonSpinner,
  IonRefresher, IonRefresherContent,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowBackOutline, receiptOutline, personOutline, documentAttachOutline, calendarOutline, close } from 'ionicons/icons';
import { GastosDiariosService } from '../../services/gastos-diarios.service';
import { GastoDiario } from '../../models/gasto-diario.model';
import { UiService } from '@core/services/ui.service';
import { StorageService } from '@core/services/storage.service';

@Component({
  selector: 'app-gastos-diarios',
  templateUrl: './gastos-diarios.page.html',
  styleUrls: ['./gastos-diarios.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton, IonIcon, IonSpinner,
    IonRefresher, IonRefresherContent
  ]
})
export class GastosDiariosPage implements OnInit {
  private gastosService = inject(GastosDiariosService);
  private modalCtrl = inject(ModalController);
  private ui = inject(UiService);
  private storageService = inject(StorageService);

  // Datos
  gastos: GastoDiario[] = [];
  gastosAgrupados: { fecha: string; gastos: GastoDiario[] }[] = [];
  totalGastos = 0;

  // Filtros
  filtroActivo: 'hoy' | 'semana' | 'mes' | 'todo' = 'mes';

  // Loading
  loading = false;

  constructor() {
    addIcons({
      arrowBackOutline,
      receiptOutline,
      personOutline,
      documentAttachOutline,
      calendarOutline,
      close
    });
  }

  ngOnInit() {
    this.cargarGastos();
  }

  /**
   * Oculta los tabs al entrar a la página
   */
  ionViewWillEnter() {
    this.ui.hideTabs();
  }

  /**
   * Muestra los tabs al salir de la página
   */
  ionViewWillLeave() {
    this.ui.showTabs();
  }

  async handleRefresh(event: any) {
    await this.cargarGastos();
    event.target.complete();
  }

  /**
   * Cambia el filtro y recarga los datos
   */
  cambiarFiltro(filtro: 'hoy' | 'semana' | 'mes' | 'todo') {
    this.filtroActivo = filtro;
    this.cargarGastos();
  }

  /**
   * Carga los gastos según el filtro activo
   */
  async cargarGastos() {
    this.loading = true;
    try {
      const { fechaInicio, fechaFin } = this.obtenerRangoFechas();

      const [gastos, total] = await Promise.all([
        this.gastosService.getGastos(fechaInicio, fechaFin),
        this.gastosService.getTotalGastos(fechaInicio, fechaFin)
      ]);

      this.gastos = gastos;
      this.totalGastos = total;
      this.agruparPorFecha();
    } catch {
      await this.ui.showError('Error al cargar los gastos. Verificá tu conexión.');
    } finally {
      this.loading = false;
    }
  }

  /**
   * Obtiene el rango de fechas según el filtro activo
   */
  private obtenerRangoFechas(): { fechaInicio: string; fechaFin: string } {
    const hoy = new Date();
    const fechaFin = this.formatearFecha(hoy);

    let fechaInicio: string;

    switch (this.filtroActivo) {
      case 'hoy':
        fechaInicio = fechaFin;
        break;

      case 'semana':
        const semanaAtras = new Date(hoy);
        semanaAtras.setDate(hoy.getDate() - 7);
        fechaInicio = this.formatearFecha(semanaAtras);
        break;

      case 'mes':
        const mesAtras = new Date(hoy);
        mesAtras.setMonth(hoy.getMonth() - 1);
        fechaInicio = this.formatearFecha(mesAtras);
        break;

      case 'todo':
        fechaInicio = '2020-01-01'; // Fecha muy antigua
        break;
    }

    return { fechaInicio, fechaFin };
  }

  /**
   * Formatea una fecha a YYYY-MM-DD
   */
  private formatearFecha(fecha: Date): string {
    const year = fecha.getFullYear();
    const month = String(fecha.getMonth() + 1).padStart(2, '0');
    const day = String(fecha.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Agrupa los gastos por fecha
   */
  private agruparPorFecha() {
    const grupos: { [fecha: string]: GastoDiario[] } = {};

    for (const gasto of this.gastos) {
      if (!grupos[gasto.fecha]) {
        grupos[gasto.fecha] = [];
      }
      grupos[gasto.fecha].push(gasto);
    }

    this.gastosAgrupados = Object.keys(grupos)
      .sort((a, b) => b.localeCompare(a)) // Más reciente primero
      .map(fecha => ({
        fecha,
        gastos: grupos[fecha]
      }));
  }

  /**
   * Formatea una fecha para mostrar (ej: "Lunes, 9 de febrero")
   */
  formatearFechaLegible(fecha: string): string {
    const [year, month, day] = fecha.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    const opciones: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    };

    return date.toLocaleDateString('es-ES', opciones);
  }

  /**
   * Calcula el total de gastos de un día
   */
  calcularTotalDia(gastos: GastoDiario[]): string {
    const total = gastos.reduce((sum, gasto) => sum + gasto.monto, 0);
    return total.toFixed(2);
  }

  /**
   * Formatea la hora desde un timestamp (ej: "14:30")
   */
  formatearHora(timestamp: string): string {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * Abre la imagen del comprobante en modal
   */
  async verComprobante(path: string) {
    await this.ui.showLoading('Cargando comprobante...');
    try {
      const signedUrl = await this.storageService.getSignedUrl(path);

      if (!signedUrl) {
        await this.ui.showError('No se pudo cargar el comprobante');
        return;
      }

      const modal = await this.modalCtrl.create({
        component: ComprobanteGastoModalComponent,
        componentProps: { url: signedUrl },
        cssClass: 'comprobante-modal'
      });
      await modal.present();
    } catch {
      await this.ui.showError('No se pudo cargar el comprobante');
    } finally {
      await this.ui.hideLoading();
    }
  }
}

// ==========================================
// COMPONENTE INLINE: Modal de Comprobante (Gastos)
// ==========================================
@Component({
  selector: 'app-comprobante-gasto-modal',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Comprobante</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="cerrar()">
            <ion-icon slot="icon-only" name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="comprobante-container">
        <img [src]="url" alt="Comprobante" />
      </div>
    </ion-content>
  `,
  styles: [`
    .comprobante-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100%;
    }

    img {
      width: 100%;
      height: auto;
      max-width: 600px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
  `],
  standalone: true,
  imports: [
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon
  ]
})
class ComprobanteGastoModalComponent {
  private modalCtrl = inject(ModalController);
  url: string = '';

  cerrar() {
    this.modalCtrl.dismiss();
  }
}
