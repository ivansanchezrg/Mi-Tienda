import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonCard, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, checkmarkCircleOutline, cashOutline,
  walletOutline, alertCircleOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { RecargasVirtualesService, RecargaVirtual } from '@core/services/recargas-virtuales.service';

@Component({
  selector: 'app-pagar-deudas-modal',
  templateUrl: './pagar-deudas-modal.component.html',
  styleUrls: ['./pagar-deudas-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonCard
  ]
})
export class PagarDeudasModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private ui = inject(UiService);
  private service = inject(RecargasVirtualesService);

  loading = true;
  deudasPendientes: RecargaVirtual[] = [];
  deudasSeleccionadas = new Set<string>();
  saldoDisponible = 0;

  constructor() {
    addIcons({
      closeOutline,
      checkmarkCircleOutline,
      cashOutline,
      walletOutline,
      alertCircleOutline
    });
  }

  async ngOnInit() {
    await this.cargarDatos();
  }

  async cargarDatos() {
    this.loading = true;
    try {
      const [deudas, saldo] = await Promise.all([
        this.service.obtenerDeudasPendientesCelular(),
        this.service.getSaldoCajaActual('CAJA_CELULAR')
      ]);
      this.deudasPendientes = deudas;
      this.saldoDisponible = saldo;
    } catch {
      await this.ui.showError('Error al cargar las deudas');
    } finally {
      this.loading = false;
    }
  }

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

  get totalGananciaSeleccionada(): number {
    return this.deudasPendientes
      .filter(d => this.deudasSeleccionadas.has(d.id))
      .reduce((sum, d) => sum + (d.ganancia ?? 0), 0);
  }

  get totalDeudas(): number {
    return this.deudasPendientes.reduce((sum, d) => sum + d.monto_a_pagar, 0);
  }

  get saldoDespues(): number {
    return this.saldoDisponible - this.totalSeleccionado - this.totalGananciaSeleccionada;
  }

  get saldoSuficiente(): boolean {
    return this.saldoDespues >= 0;
  }

  get puedeConfirmar(): boolean {
    return this.deudasSeleccionadas.size > 0 && this.saldoSuficiente;
  }

  async confirmarPago() {
    if (!this.puedeConfirmar) return;

    const empleado = await this.service.obtenerEmpleadoActual();
    if (!empleado) {
      await this.ui.showError('No se pudo obtener el empleado');
      return;
    }

    const resultado = await this.service.registrarPagoProveedorCelular({
      empleado_id: empleado.id,
      deuda_ids: Array.from(this.deudasSeleccionadas)
    });

    if (!resultado) return;

    await this.ui.showSuccess(resultado.message ?? `Pago registrado: $${this.totalSeleccionado.toFixed(2)}`);
    this.modalCtrl.dismiss({ success: true });
  }

  formatearFecha(fecha: string): string {
    const d = new Date(fecha + 'T00:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }
}

