import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonList, IonItem, IonLabel, IonIcon, IonText,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  close, phonePortraitOutline, busOutline,
  notificationsOffOutline, chevronForwardOutline
} from 'ionicons/icons';
import { Notificacion } from '../../services/notificaciones.service';

@Component({
  selector: 'app-notificaciones-modal',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Notificaciones</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="cerrar()">
            <ion-icon slot="icon-only" name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (notificaciones.length > 0) {
        <ion-list>
          @for (notif of notificaciones; track notif.tipo) {
            <ion-item button (click)="navegar(notif)">
              <ion-icon
                slot="start"
                [name]="notif.tipo === 'DEUDA_CELULAR' ? 'phone-portrait-outline' : 'bus-outline'"
                [color]="notif.tipo === 'DEUDA_CELULAR' ? 'secondary' : 'warning'">
              </ion-icon>
              <ion-label>
                <h2>{{ notif.titulo }}</h2>
                <p>{{ notif.descripcion }}</p>
                @if (notif.subtitulo) {
                  <p>
                    <ion-text color="medium">
                      <small>{{ notif.subtitulo }} → ir a Recargas Virtuales</small>
                    </ion-text>
                  </p>
                }
              </ion-label>
              <ion-icon slot="end" name="chevron-forward-outline" color="medium"></ion-icon>
            </ion-item>
          }
        </ion-list>
      } @else {
        <div class="ion-padding ion-text-center">
          <ion-icon name="notifications-off-outline" size="large" color="medium"></ion-icon>
          <h3>No hay notificaciones</h3>
          <p>
            <ion-text color="medium">Todas las notificaciones están al día</ion-text>
          </p>
        </div>
      }
    </ion-content>
  `,
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonList, IonItem, IonLabel, IonIcon, IonText
  ]
})
export class NotificacionesModalComponent {
  private modalCtrl = inject(ModalController);
  private router    = inject(Router);

  notificaciones: Notificacion[] = [];

  constructor() {
    addIcons({ close, phonePortraitOutline, busOutline, notificationsOffOutline, chevronForwardOutline });
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
