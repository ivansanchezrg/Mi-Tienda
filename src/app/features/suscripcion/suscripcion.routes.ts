import { Routes } from '@angular/router';

export const SUSCRIPCION_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/suscripcion/suscripcion.page').then(m => m.SuscripcionPage),
  },
];
