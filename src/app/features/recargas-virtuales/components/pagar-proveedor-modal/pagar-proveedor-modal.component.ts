import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonCheckbox,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, cardOutline } from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { RecargasVirtualesService, RecargaVirtual } from '../../services/recargas-virtuales.service';
import { AuthService } from '../../../auth/services/auth.service';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';

@Component({
  selector: 'app-pagar-proveedor-modal',
  templateUrl: './pagar-proveedor-modal.component.html',
  styleUrls: ['./pagar-proveedor-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonCheckbox,
    AppCurrencyPipe,
  ]
})
export class PagarProveedorModalComponent implements OnInit {
  @Input() deudas: RecargaVirtual[] = [];
  @Input() cajaCelularSaldo = 0;

  private modalCtrl = inject(ModalController);
  private ui = inject(UiService);
  private service = inject(RecargasVirtualesService);
  private authService = inject(AuthService);

  // Estado de selección como objeto plano — Angular detecta cambios por referencia
  checked: Record<string, boolean> = {};
  guardando = false;

  constructor() {
    addIcons({ closeOutline, cardOutline });
  }

  ngOnInit() {
    // Todas seleccionadas por defecto
    const state: Record<string, boolean> = {};
    this.deudas.forEach(d => state[d.id] = true);
    this.checked = state;
  }

  onItemChange(id: string, value: boolean) {
    this.checked = { ...this.checked, [id]: value };
  }

  onToggleTodas(value: boolean) {
    const state: Record<string, boolean> = {};
    this.deudas.forEach(d => state[d.id] = value);
    this.checked = state;
  }

  get todasSeleccionadas(): boolean {
    return this.deudas.length > 0 && this.deudas.every(d => this.checked[d.id]);
  }

  get algunaSeleccionada(): boolean {
    return this.deudas.some(d => this.checked[d.id]);
  }

  get indeterminate(): boolean {
    return this.algunaSeleccionada && !this.todasSeleccionadas;
  }

  get totalSeleccionado(): number {
    return Math.round(
      this.deudas
        .filter(d => this.checked[d.id])
        .reduce((s, d) => s + d.monto_a_pagar, 0) * 100
    ) / 100;
  }

  get saldoSuficiente(): boolean {
    return this.cajaCelularSaldo >= this.totalSeleccionado;
  }

  get puedePagar(): boolean {
    return this.algunaSeleccionada && this.saldoSuficiente && !this.guardando;
  }

  get idsSeleccionadas(): string[] {
    return this.deudas.filter(d => this.checked[d.id]).map(d => d.id);
  }

  formatearFecha(fecha: string): string {
    const d = new Date(fecha + 'T00:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }

  async confirmar() {
    if (!this.puedePagar) return;
    this.guardando = true;
    try {
      const empleado = await this.authService.getUsuarioActual();
      if (!empleado) {
        await this.ui.showError('No se pudo obtener el empleado');
        return;
      }
      const resultado = await this.service.pagarProveedorCelular(
        empleado.id,
        this.idsSeleccionadas
      );
      await this.ui.showSuccess(resultado.message);
      this.modalCtrl.dismiss({ success: true });
    } catch (err: any) {
      await this.ui.showError(err?.message ?? 'Error al registrar el pago');
    } finally {
      this.guardando = false;
    }
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }
}
