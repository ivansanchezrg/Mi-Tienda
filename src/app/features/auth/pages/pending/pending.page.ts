import { Component, inject } from '@angular/core';
import {
  IonContent,
  IonButton,
  IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { timeOutline, refreshOutline, logOutOutline } from 'ionicons/icons';
import { AuthService } from '../../services/auth.service';
import { UiService } from '@core/services/ui.service';

@Component({
  selector: 'app-pending',
  templateUrl: './pending.page.html',
  styleUrls: ['./pending.page.scss'],
  standalone: true,
  imports: [IonContent, IonButton, IonIcon]
})
export class PendingPage {

  private authService = inject(AuthService);
  private ui = inject(UiService);

  verificando = false;

  constructor() {
    addIcons({ timeOutline, refreshOutline, logOutOutline });
  }

  async reintentar() {
    if (this.verificando) return;
    this.verificando = true;

    try {
      const acceso = await this.authService.validarUsuario();
      // validarUsuario() navega sola si hay acceso (retorna true).
      // Si retorna false y no hubo error (ya mostrado internamente), el usuario
      // sigue sin acceso → mostrar feedback para que sepa que se verificó.
      if (!acceso) {
        await this.ui.showToast('Tu cuenta sigue inactiva. Contactá al administrador.', 'warning');
      }
    } finally {
      this.verificando = false;
    }
  }

  async cerrarSesion() {
    await this.authService.logoutSilent();
  }
}
