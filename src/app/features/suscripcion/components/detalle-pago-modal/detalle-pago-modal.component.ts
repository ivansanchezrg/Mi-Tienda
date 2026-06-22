import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, checkmarkCircleOutline, calendarOutline,
  cardOutline, documentTextOutline, timeOutline,
} from 'ionicons/icons';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';
import { SuscripcionPago } from '../../models/suscripcion.model';

/**
 * Detalle de un pago de suscripción ya registrado. Solo lectura — los datos
 * vienen de suscripcion_pagos (inmutable desde el cliente). No hay PDF ni
 * comprobante adjunto: el "nota" es la referencia/comprobante en texto libre
 * que el superadmin registró al cobrar.
 */
@Component({
  selector: 'app-detalle-pago-modal',
  templateUrl: './detalle-pago-modal.component.html',
  styleUrls: ['./detalle-pago-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonIcon, AppCurrencyPipe],
})
export class DetallePagoModalComponent {
  @Input({ required: true }) pago!: SuscripcionPago;

  private modalCtrl = inject(ModalController);

  constructor() {
    addIcons({ closeOutline, checkmarkCircleOutline, calendarOutline, cardOutline, documentTextOutline, timeOutline });
  }

  get periodoLabel(): string {
    return this.pago.periodo === 'ANUAL' ? 'Anual' : 'Mensual';
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }
}
