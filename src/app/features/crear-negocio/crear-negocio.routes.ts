import { Routes } from '@angular/router';
import { authGuard } from '../../core/guards/auth.guard';

/**
 * Wizard reutilizable para crear un negocio desde dentro del dashboard.
 * Usa las mismas paginas del onboarding inicial (OnboardingNegocioPage / OnboardingCajaPage)
 * pero con el modo determinado por el query param `?context=`.
 *
 * Modos resueltos:
 *   - context=sucursal     → 'sucursal-admin' o 'sucursal-superadmin' segun rol del usuario
 *   - context=admin        → siempre 'sucursal-superadmin' (solo superadmin desde /admin)
 *
 * El componente que entra primero (OnboardingNegocioPage) es responsable de leer el
 * query param y llamar a OnboardingService.setMode() antes de mostrar el formulario.
 */
export const CREAR_NEGOCIO_ROUTES: Routes = [
  {
    // El guard se aplica a nivel padre — protege todas las subrutas hijas.
    path: '',
    canActivate: [authGuard],
    children: [
      {
        path: '',
        redirectTo: 'negocio',
        pathMatch: 'full'
      },
      {
        path: 'negocio',
        loadComponent: () => import('../onboarding/pages/negocio/onboarding-negocio.page').then(m => m.OnboardingNegocioPage)
      },
      {
        path: 'caja',
        loadComponent: () => import('../onboarding/pages/caja/onboarding-caja.page').then(m => m.OnboardingCajaPage)
      }
    ]
  }
];
