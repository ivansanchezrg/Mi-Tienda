import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton, IonRefresher, IonRefresherContent,
  IonCard, IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  walletOutline, cashOutline, phonePortraitOutline, busOutline,
  chevronForwardOutline, chevronDownOutline, checkmarkCircle, closeCircle,
  arrowDownOutline, arrowUpOutline, swapHorizontalOutline,
  receiptOutline, clipboardOutline
} from 'ionicons/icons';
import { ScrollablePage } from '@core/pages/scrollable.page';
import { UiService } from '@core/services/ui.service';
import { RecargasService } from '../../services/recargas.service';
import { CajasService } from '../../services/cajas.service';

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton, IonRefresher, IonRefresherContent,
    IonCard, IonIcon
  ]
})
export class HomePage extends ScrollablePage {
  private router = inject(Router);
  private ui = inject(UiService);
  private recargasService = inject(RecargasService);
  private cajasService = inject(CajasService);

  cajaAbierta = true;

  // Saldos de cajas (se cargan desde BD)
  saldoCaja = 0;
  saldoCajaChica = 0;
  saldoCelular = 0;
  saldoBus = 0;
  totalSaldos = 0;

  // Usuario actual
  nombreUsuario = '';
  horaApertura = '7:00 AM';

  constructor() {
    super();
    addIcons({
      walletOutline, cashOutline, phonePortraitOutline, busOutline,
      chevronForwardOutline, chevronDownOutline, checkmarkCircle, closeCircle,
      arrowDownOutline, arrowUpOutline, swapHorizontalOutline,
      receiptOutline, clipboardOutline
    });
  }

  override ionViewWillEnter(): void {
    super.ionViewWillEnter();
    this.cargarSaldos();
  }

  /**
   * Carga los saldos actuales de todas las cajas desde la BD
   */
  async cargarSaldos() {
    const saldos = await this.cajasService.obtenerSaldosCajas();

    if (saldos) {
      this.saldoCaja = saldos.cajaPrincipal;
      this.saldoCajaChica = saldos.cajaChica;
      this.saldoCelular = saldos.cajaCelular;
      this.saldoBus = saldos.cajaBus;
      this.totalSaldos = saldos.total;
    }

    // Cargar usuario actual
    const user = await this.recargasService.obtenerEmpleadoActual();
    this.nombreUsuario = user?.nombre || 'Usuario';
  }

  get totalEfectivo(): number {
    return this.totalSaldos;
  }

  async handleRefresh(event: any) {
    await this.cargarSaldos();
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

  onAbrirDia() {
    // TODO: Implementar apertura de día
  }
}
