import { Routes } from '@angular/router';

export const VENTAS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/listado/ventas-listado.page').then(m => m.VentasListadoPage)
  },
  {
    path: 'resumen',
    loadComponent: () => import('./pages/resumen/ventas-resumen.page').then(m => m.VentasResumenPage)
  }
];
