import { Routes } from '@angular/router';

export const CUENTAS_CORRIENTES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/hub/cuentas-corrientes-hub.page')
      .then(m => m.CuentasCorrientesHubPage)
  }
];
