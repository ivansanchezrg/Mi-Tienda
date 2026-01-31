import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonSpinner, ModalController
} from '@ionic/angular/standalone';
import { LoggerService } from '@core/services/logger.service';

@Component({
  selector: 'app-logs-modal',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Logs de la App</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="cerrar()">Cerrar</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      @if (loading) {
        <div class="loading-container">
          <ion-spinner></ion-spinner>
        </div>
      } @else {
        <pre class="logs-content">{{ logs }}</pre>
      }
    </ion-content>
  `,
  styles: [`
    .loading-container {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100%;
    }
    .logs-content {
      font-size: 11px;
      white-space: pre-wrap;
      word-break: break-all;
      margin: 0;
      font-family: monospace;
    }
  `],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonSpinner
  ]
})
export class LogsModalComponent implements OnInit {
  private logger = inject(LoggerService);
  private modalCtrl = inject(ModalController);

  logs = '';
  loading = true;

  async ngOnInit() {
    this.logs = await this.logger.getLogs();
    this.loading = false;
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }
}
