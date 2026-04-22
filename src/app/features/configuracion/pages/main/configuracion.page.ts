import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonMenuButton,
  IonCard, IonList, IonItem, IonIcon, IonLabel,
  AlertController, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { settingsOutline, constructOutline, documentTextOutline, trashOutline, listOutline, chevronForwardOutline, receiptOutline, pricetagOutline } from 'ionicons/icons';
import { LoggerService } from '@core/services/logger.service';
import { UiService } from '@core/services/ui.service';
import { LogsModalComponent } from '../../components/logs-modal/logs-modal.component';
import { ROUTES } from '@core/config/routes.config';

@Component({
  selector: 'app-configuracion',
  templateUrl: './configuracion.page.html',
  styleUrls: ['./configuracion.page.scss'],
  standalone: true,
  imports: [
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonMenuButton,
    IonCard, IonList, IonItem, IonIcon, IonLabel
  ]
})
export class ConfiguracionPage {
  private logger    = inject(LoggerService);
  private alertCtrl = inject(AlertController);
  private modalCtrl = inject(ModalController);
  private ui        = inject(UiService);
  private router    = inject(Router);

  constructor() {
    addIcons({ settingsOutline, constructOutline, documentTextOutline, trashOutline, listOutline, chevronForwardOutline, receiptOutline, pricetagOutline });
  }

  ionViewWillEnter() {
    this.ui.hideTabs();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  irA(ruta: 'parametros' | 'categorias-operaciones' | 'categorias-productos') {
    this.router.navigate([ROUTES.configuracion.root, ruta]);
  }

  async verLogs() {
    const modal = await this.modalCtrl.create({
      component: LogsModalComponent
    });
    await modal.present();
  }

  async limpiarLogs() {
    const alert = await this.alertCtrl.create({
      header: 'Limpiar Logs',
      message: '¿Estás seguro de que deseas eliminar todos los logs?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: async () => {
            await this.logger.clearLogs();
            await this.ui.showSuccess('Logs eliminados');
          }
        }
      ]
    });
    await alert.present();
  }
}
