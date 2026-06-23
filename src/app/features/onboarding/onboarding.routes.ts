import { Routes } from '@angular/router';

export const ONBOARDING_ROUTES: Routes = [
  {
    path: '',
    redirectTo: 'negocio',
    pathMatch: 'full'
  },
  {
    path: 'negocio',
    loadComponent: () => import('./pages/negocio/onboarding-negocio.page').then(m => m.OnboardingNegocioPage)
  },
  {
    path: 'contexto',
    loadComponent: () => import('./pages/contexto/onboarding-contexto.page').then(m => m.OnboardingContextoPage)
  },
  {
    path: 'caja',
    loadComponent: () => import('./pages/caja/onboarding-caja.page').then(m => m.OnboardingCajaPage)
  }
];
