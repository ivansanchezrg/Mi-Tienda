import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonButton, IonIcon, IonProgressBar } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  fileTrayOutline, cashOutline, shieldCheckmarkOutline, arrowForwardOutline
} from 'ionicons/icons';
import { OnboardingService } from '../../services/onboarding.service';
import { ROUTES } from '@core/config/routes.config';

@Component({
  selector: 'app-onboarding-contexto',
  templateUrl: './onboarding-contexto.page.html',
  styleUrls: ['./onboarding-contexto.page.scss'],
  standalone: true,
  imports: [IonContent, IonButton, IonIcon, IonProgressBar]
})
export class OnboardingContextoPage {
  private router            = inject(Router);
  private onboardingService = inject(OnboardingService);

  constructor() {
    addIcons({ fileTrayOutline, cashOutline, shieldCheckmarkOutline, arrowForwardOutline });
  }

  continuar() {
    const ruta = this.onboardingService.mode === 'inicial'
      ? ROUTES.onboarding.caja
      : ROUTES.crearNegocio.caja;
    this.router.navigate([ruta], { replaceUrl: true });
  }
}
