import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonIcon, IonCheckbox, IonSpinner,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, cashOutline, trendingUpOutline, alertCircleOutline } from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { FeedbackOverlayService } from '@core/services/feedback-overlay.service';
import { RecargasVirtualesService, RecargaVirtual } from '../../services/recargas-virtuales.service';
import { AuthService } from '../../../auth/services/auth.service';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';
import { CurrencyService } from '@core/services/currency.service';

@Component({
  selector: 'app-pagar-proveedor-modal',
  templateUrl: './pagar-proveedor-modal.component.html',
  styleUrls: ['./pagar-proveedor-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonIcon, IonCheckbox, IonSpinner,
    AppCurrencyPipe,
  ]
})
export class PagarProveedorModalComponent implements OnInit {
  @Input() deudas: RecargaVirtual[] = [];
  @Input() cajaCelularSaldo = 0;

  private modalCtrl = inject(ModalController);
  private ui = inject(UiService);
  private feedback = inject(FeedbackOverlayService);
  private service = inject(RecargasVirtualesService);
  private authService = inject(AuthService);
  private currencyService = inject(CurrencyService);

  // Estado de selección como objeto plano — Angular detecta cambios por referencia
  checked: Record<string, boolean> = {};
  guardando = false;

  constructor() {
    addIcons({ closeOutline, cashOutline, trendingUpOutline, alertCircleOutline });
  }

  ngOnInit() {
    // Ninguna seleccionada por defecto — el usuario marca manualmente lo que va a pagar
    const state: Record<string, boolean> = {};
    this.deudas.forEach(d => state[d.id] = false);
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
      // Overlay (no toast): el modal se cierra inmediatamente después — un toast
      // disparado justo antes de esa transición compite con ella y se pierde.
      this.feedback.success({
        titulo: 'Pago registrado',
        destacado: `$${this.currencyService.format(resultado.total_pagado)}`,
        subtitulo: `${resultado.filas_afectadas} recarga${resultado.filas_afectadas === 1 ? '' : 's'} pagada${resultado.filas_afectadas === 1 ? '' : 's'} · Caja Celular: $${this.currencyService.format(resultado.saldo_caja_celular_nuevo)}`,
      });
      this.modalCtrl.dismiss({ success: true });
    } catch (err: any) {
      this.feedback.error({
        titulo: 'No se pudo registrar el pago',
        subtitulo: err?.message ?? 'Intenta de nuevo',
      });
    } finally {
      this.guardando = false;
    }
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }
}
