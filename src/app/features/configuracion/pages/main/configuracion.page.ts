import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonMenuButton,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonList, IonItem, IonIcon, IonLabel, IonToggle, IonButton
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  personOutline, personCircleOutline, settingsOutline, moonOutline,
  notificationsOutline, languageOutline, informationCircleOutline,
  codeOutline, helpCircleOutline, logOutOutline
} from 'ionicons/icons';
import { AuthService } from '../../../auth/services/auth.service';

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

  empleadoNombre = '';
  empleadoEmail = '';

  darkMode = false;

  constructor() {
    addIcons({
      personOutline, personCircleOutline, settingsOutline, moonOutline,
      notificationsOutline, languageOutline, informationCircleOutline,
      codeOutline, helpCircleOutline, logOutOutline
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
}
