import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonCard
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chevronBackOutline, checkmarkCircleOutline, walletOutline, cashOutline,
  closeCircleOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { RecargasVirtualesService, RecargaVirtual } from '@core/services/recargas-virtuales.service';
import { AuthService } from '../../../auth/services/auth.service';

@Component({
  selector: 'app-pagar-deudas',
  templateUrl: './pagar-deudas.page.html',
  styleUrls: ['./pagar-deudas.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonCard
  ]
})
export class PagarDeudasPage implements OnInit {
  private router = inject(Router);
  private ui = inject(UiService);
  private service = inject(RecargasVirtualesService);
  private authService = inject(AuthService);

  pasoActual = 1;
  loading = true;

  // Datos
  deudasPendientes: RecargaVirtual[] = [];
  deudasSeleccionadas = new Set<string>();
  saldoDisponible = 0;

  constructor() {
    addIcons({
      chevronBackOutline,
      checkmarkCircleOutline,
      walletOutline,
      cashOutline,
      closeCircleOutline
    });
  }

  async ngOnInit() {
    await this.cargarDatos();
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
      const [deudas, saldo] = await Promise.all([
        this.service.obtenerDeudasPendientesCelular(),
        this.service.getSaldoVirtualActual('CELULAR')
      ]);
      this.deudasPendientes = deudas;
      this.saldoDisponible = saldo;
    } catch (error) {
      console.error('Error al cargar deudas:', error);
      await this.ui.showError('Error al cargar las deudas');
    } finally {
      this.loading = false;
    }
  }

  // Paso 1: Selección
  toggleDeuda(id: string) {
    if (this.deudasSeleccionadas.has(id)) {
      this.deudasSeleccionadas.delete(id);
    } else {
      this.deudasSeleccionadas.add(id);
    }
  }

  seleccionarTodas() {
    if (this.deudasSeleccionadas.size === this.deudasPendientes.length) {
      this.deudasSeleccionadas.clear();
    } else {
      this.deudasPendientes.forEach(d => this.deudasSeleccionadas.add(d.id));
    }
  }

  get totalSeleccionado(): number {
    return this.deudasPendientes
      .filter(d => this.deudasSeleccionadas.has(d.id))
      .reduce((sum, d) => sum + d.monto_a_pagar, 0);
  }

  get totalDeudas(): number {
    return this.deudasPendientes.reduce((sum, d) => sum + d.monto_a_pagar, 0);
  }

  async siguientePaso() {
    if (this.deudasSeleccionadas.size === 0) {
      await this.ui.showError('Seleccioná al menos una deuda');
      return;
    }
    this.pasoActual = 2;
  }

  // Paso 2: Confirmación
  get saldoDespues(): number {
    return this.saldoDisponible - this.totalSeleccionado;
  }

  get saldoSuficiente(): boolean {
    return this.saldoDespues >= 0;
  }

  pasoAnterior() {
    this.pasoActual = 1;
  }

  async confirmarPago() {
    if (!this.saldoSuficiente) {
      await this.ui.showError('Saldo insuficiente en CAJA CELULAR');
      return;
    }

    const empleado = await this.authService.getUsuarioActual();
    if (!empleado) {
      await this.ui.showError('No se pudo obtener el empleado');
      return;
    }

    const resultado = await this.service.registrarPagoProveedorCelular({
      empleado_id: empleado.id,
      deuda_ids: Array.from(this.deudasSeleccionadas)
    });

    if (!resultado) return;

    await this.ui.showSuccess(`Pago registrado: $${this.totalSeleccionado.toFixed(2)}`);
    this.router.navigate(['/home/recargas-virtuales'], { queryParams: { refresh: true } });
  }

  formatearFecha(fecha: string): string {
    const d = new Date(fecha + 'T00:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  volver() {
    this.router.navigate(['/home/recargas-virtuales']);
  }
}

