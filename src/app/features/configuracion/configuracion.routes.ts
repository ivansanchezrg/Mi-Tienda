import { Routes } from '@angular/router';

export const CONFIGURACION_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/main/configuracion.page').then(m => m.ConfiguracionPage)
  }
];
