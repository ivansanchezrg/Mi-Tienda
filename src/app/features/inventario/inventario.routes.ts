import { Routes } from '@angular/router';

export const INVENTARIO_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/main/inventario.page').then(m => m.InventarioPage)
  }
];
