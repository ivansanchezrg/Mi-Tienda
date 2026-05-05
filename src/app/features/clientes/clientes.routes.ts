import { Routes } from '@angular/router';

export const CLIENTES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/listado/clientes-listado.page').then(m => m.ClientesListadoPage)
  },
  {
    path: ':clienteId',
    loadComponent: () => import('./pages/detalle/detalle-cliente.page').then(m => m.DetalleClientePage)
  }
];
