import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, phonePortraitOutline, busOutline, calendarOutline,
  notificationsOffOutline, chevronForwardOutline
} from 'ionicons/icons';
import { Notificacion } from '../../services/notificaciones.service';

@Component({
  selector: 'app-notificaciones-modal',
  templateUrl: './notificaciones-modal.component.html',
  styleUrls: ['./notificaciones-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon
  ]
})
export class NotificacionesModalComponent {
  private modalCtrl = inject(ModalController);
  private router = inject(Router);

  notificaciones: Notificacion[] = [];

  constructor() {
    addIcons({
      closeOutline, phonePortraitOutline, busOutline, calendarOutline,
      notificationsOffOutline, chevronForwardOutline
    });
  }

  getIconClass(tipo: string): string {
    if (tipo === 'DEUDA_CELULAR') return 'celular';
    if (tipo === 'SALDO_BAJO_BUS') return 'bus';
    return 'facturacion';
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }

  async navegar(notif: Notificacion) {
    await this.modalCtrl.dismiss({ reload: false });
    const tab = notif.tipo === 'SALDO_BAJO_BUS' ? 'BUS' : 'CELULAR';
    await this.router.navigate(['/home/recargas-virtuales'], { queryParams: { tab } });
  }
}
