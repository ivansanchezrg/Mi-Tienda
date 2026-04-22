import { Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent,
  IonButton,
  IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { timeOutline, refreshOutline, logOutOutline } from 'ionicons/icons';
import { AuthService } from '../../services/auth.service';
import { UiService } from '@core/services/ui.service';
import { ROUTES } from '@core/config/routes.config';

@Component({
  selector: 'app-pending',
  templateUrl: './pending.page.html',
  styleUrls: ['./pending.page.scss'],
  standalone: true,
  imports: [IonContent, IonButton, IonIcon]
})
export class PendingPage {

  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private ui = inject(UiService);

  verificando = false;

  /** true = recién registrado por primera vez */
  readonly esNuevo = this.route.snapshot.queryParamMap.get('estado') === 'nuevo';

  constructor() {
    addIcons({ timeOutline, refreshOutline, logOutOutline });
  }

  async reintentar() {
    if (this.verificando) return;
    this.verificando = true;

    try {
      const isValid = await this.authService.validarUsuario();
      if (isValid) {
        this.router.navigate([ROUTES.home], { replaceUrl: true });
      } else {
        this.ui.showToast('Tu cuenta aún no ha sido aprobada', 'warning');
      }
    } finally {
      this.verificando = false;
    }
  }

  async cerrarSesion() {
    await this.authService.logoutSilent();
  }
}
