import { Component, inject } from '@angular/core';
import {
  IonContent,
  IonButton,
  IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { refreshOutline, logOutOutline, banOutline } from 'ionicons/icons';
import { AuthService } from '../../services/auth.service';

/**
 * Pantalla mostrada cuando el admin removió la membresía del usuario en el
 * negocio actual (usuario_negocios.activo=false). La suspensión global por
 * cobro (suscripciones) usa otra pantalla: ROUTES.suscripcion.
 */
@Component({
  selector: 'app-pending',
  templateUrl: './pending.page.html',
  styleUrls: ['./pending.page.scss'],
  standalone: true,
  imports: [IonContent, IonButton, IonIcon]
})
export class PendingPage {
  private authService = inject(AuthService);

  verificando = false;

  constructor() {
    addIcons({ refreshOutline, logOutOutline, banOutline });
  }

  readonly icono = 'ban-outline';
  readonly titulo = 'Acceso removido';
  readonly mensaje = 'Tu acceso a este negocio fue removido. Contacta al administrador si crees que es un error.';

  async reintentar() {
    if (this.verificando) return;
    this.verificando = true;
    try {
      await this.authService.validarUsuario();
    } finally {
      this.verificando = false;
    }
  }

  async cerrarSesion() {
    await this.authService.logoutSilent();
  }
}
