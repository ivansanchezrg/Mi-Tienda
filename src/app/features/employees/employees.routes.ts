import { Routes } from '@angular/router';

export const EMPLOYEES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/list/list.page').then(m => m.ListPage)
  }
];
