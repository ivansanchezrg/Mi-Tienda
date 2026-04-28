import { Routes } from '@angular/router';
import { superadminGuard } from '../../core/guards/superadmin.guard';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    canActivate: [superadminGuard],
    loadComponent: () =>
      import('./pages/dashboard/admin-dashboard.page').then(m => m.AdminDashboardPage)
  }
];
