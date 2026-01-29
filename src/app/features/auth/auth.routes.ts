import { Routes } from '@angular/router';
import { publicGuard } from '../../core/guards/public.guard';
import { LoginPage } from './pages/login/login.page';
import { CallbackPage } from './pages/callback/callback.page';

export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    component: LoginPage,
    canActivate: [publicGuard]
  },
  {
    path: 'callback',
    component: CallbackPage
  },
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full'
  }
];
