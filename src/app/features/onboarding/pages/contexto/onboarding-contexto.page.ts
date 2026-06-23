import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonButton, IonIcon, IonProgressBar } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  fileTrayOutline, cashOutline, shieldCheckmarkOutline, arrowForwardOutline,
  arrowBackOutline, informationCircleOutline
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
export class OnboardingContextoPage implements OnInit {
  private router            = inject(Router);
  private onboardingService = inject(OnboardingService);

  /** Nombre del paso 1 — protagonista del paso educativo (hilo narrativo del wizard). */
  get nombreNegocio(): string {
    return this.onboardingService.draft.nombre || 'Tu negocio';
  }

  constructor() {
    addIcons({
      fileTrayOutline, cashOutline, shieldCheckmarkOutline, arrowForwardOutline,
      arrowBackOutline, informationCircleOutline
    });
  }

  ngOnInit() {
    // El draft vive solo en memoria: si el usuario recarga aqui, el nombre del
    // negocio se perdio y el paso final fallaria. Volver al paso 1.
    if (!this.onboardingService.draft.nombre) {
      this.volver();
    }
  }

  continuar() {
    const ruta = this.onboardingService.mode === 'inicial'
      ? ROUTES.onboarding.caja
      : ROUTES.crearNegocio.caja;
    this.router.navigate([ruta], { replaceUrl: true });
  }

  /** Permite corregir el nombre del negocio sin quedar atrapado (replaceUrl mata el back del navegador). */
  volver() {
    const ruta = this.onboardingService.mode === 'inicial'
      ? ROUTES.onboarding.negocio
      : ROUTES.crearNegocio.negocio;
    this.router.navigate([ruta], { replaceUrl: true });
  }
}
