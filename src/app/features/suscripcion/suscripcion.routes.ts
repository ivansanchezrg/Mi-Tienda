import { Routes } from '@angular/router';

export const SUSCRIPCION_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/suscripcion/suscripcion.page').then(m => m.SuscripcionPage),
  },
  {
    path: 'historial',
    loadComponent: () =>
      import('./pages/historial-pagos/historial-pagos.page').then(m => m.HistorialPagosPage),
  },
];
