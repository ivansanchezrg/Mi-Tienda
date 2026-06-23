import { Routes } from '@angular/router';
import { superadminGuard } from '../../core/guards/superadmin.guard';

// Panel del superadmin con tabs internas (patrón rutas planas, igual que ventas).
// Cada página incluye su header con <app-admin-tabs>. El superadminGuard protege todas.
export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    canActivate: [superadminGuard],
    loadComponent: () =>
      import('./pages/negocios/admin-negocios.page').then(m => m.AdminNegociosPage),
  },
  {
    path: 'planes',
    canActivate: [superadminGuard],
    loadComponent: () =>
      import('./pages/planes/admin-planes.page').then(m => m.AdminPlanesPage),
  },
  {
    path: 'configuracion',
    canActivate: [superadminGuard],
    loadComponent: () =>
      import('./pages/configuracion/admin-configuracion.page').then(m => m.AdminConfiguracionPage),
  },
];
