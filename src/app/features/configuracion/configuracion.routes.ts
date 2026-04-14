import { Routes } from '@angular/router';

export const CONFIGURACION_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/main/configuracion.page').then(m => m.ConfiguracionPage)
  },
  {
    path: 'parametros',
    loadComponent: () => import('./pages/parametros/parametros.page').then(m => m.ParametrosPage)
  },
  {
    path: 'categorias-operaciones',
    loadComponent: () => import('./pages/categorias-operaciones/categorias-operaciones.page').then(m => m.CategoriasOperacionesPage)
  }
];
