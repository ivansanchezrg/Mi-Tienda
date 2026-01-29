import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes').then(m => m.AUTH_ROUTES)
  },
  {
    path: '',
    canActivate: [authGuard],
    loadChildren: () => import('./features/layout/layout.routes').then(m => m.LAYOUT_ROUTES)
  }
];
