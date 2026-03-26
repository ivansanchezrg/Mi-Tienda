import { Routes } from '@angular/router';

export const CLIENTES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/listado/clientes-listado.page').then(m => m.ClientesListadoPage)
  }
];
