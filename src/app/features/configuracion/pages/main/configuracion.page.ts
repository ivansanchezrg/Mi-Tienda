import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonMenuButton,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonList, IonItem, IonIcon, IonLabel, IonToggle, IonButton,
  AlertController, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  personOutline, personCircleOutline, settingsOutline, moonOutline,
  notificationsOutline, languageOutline, informationCircleOutline,
  codeOutline, helpCircleOutline, logOutOutline, documentTextOutline, trashOutline
} from 'ionicons/icons';
import { AuthService } from '../../../auth/services/auth.service';
import { LoggerService } from '@core/services/logger.service';
import { UiService } from '@core/services/ui.service';
import { LogsModalComponent } from '../../components/logs-modal/logs-modal.component';

@Component({
  selector: 'app-configuracion',
  templateUrl: './configuracion.page.html',
  styleUrls: ['./configuracion.page.scss'],
  standalone: true,
  imports: [
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonMenuButton,
    IonCard, IonCardHeader, IonCardTitle, IonCardContent,
    IonList, IonItem, IonIcon, IonLabel, IonToggle, IonButton
  ]
})
export class ConfiguracionPage implements OnInit {
  private authService = inject(AuthService);
  private logger = inject(LoggerService);
  private alertCtrl = inject(AlertController);
  private modalCtrl = inject(ModalController);
  private ui = inject(UiService);

  empleadoNombre = '';
  empleadoEmail = '';

  darkMode = false;

  constructor() {
    addIcons({
      personOutline, personCircleOutline, settingsOutline, moonOutline,
      notificationsOutline, languageOutline, informationCircleOutline,
      codeOutline, helpCircleOutline, logOutOutline, documentTextOutline, trashOutline
    });
  }

  async ngOnInit() {
    const user = await this.authService.getUser();
    if (user) {
      this.empleadoNombre = user.user_metadata?.['full_name'] || user.user_metadata?.['name'] || 'Usuario';
      this.empleadoEmail = user.email || '';
    }
  }

  toggleDarkMode() {
    document.body.classList.toggle('dark', this.darkMode);
  }

  async logout() {
    await this.authService.logout();
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
