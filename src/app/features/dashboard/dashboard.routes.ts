import { Routes } from '@angular/router';

import { pendingChangesGuard } from '../../core/guards/pending-changes.guard';

export const DASHBOARD_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/home/home.page').then(m => m.HomePage)
  },
  {
    path: 'cierre-diario',
    loadComponent: () => import('./pages/cierre-diario/cierre-diario.page').then(m => m.CierreDiarioPage),
    canDeactivate: [pendingChangesGuard]
  }
];
