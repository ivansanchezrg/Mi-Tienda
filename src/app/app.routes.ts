import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { suscripcionGuard } from './core/guards/suscripcion.guard';

export const routes: Routes = [
  {
    path: 'auth',
    loadChildren: () => import('./features/auth/auth.routes').then(m => m.AUTH_ROUTES)
  },
  {
    path: 'admin',
    loadChildren: () => import('./features/admin/admin.routes').then(m => m.ADMIN_ROUTES)
  },
  {
    path: 'onboarding',
    loadChildren: () => import('./features/onboarding/onboarding.routes').then(m => m.ONBOARDING_ROUTES)
  },
  {
    // Wizard reutilizable para crear sucursales / negocios desde dentro del dashboard.
    // Mismas paginas del onboarding pero con OnboardingService en modo distinto al inicial.
    path: 'crear-negocio',
    loadChildren: () => import('./features/crear-negocio/crear-negocio.routes').then(m => m.CREAR_NEGOCIO_ROUTES)
  },
  {
    // Pantalla de suscripcion: bloqueo "Suscribete" (vencida) + vista "Mi Plan".
    // Fuera del layout (sin tab bar/sidebar) y SIN suscripcionGuard — es el destino
    // del bloqueo, protegerla con ese guard causaria un loop infinito.
    path: 'suscripcion',
    canActivate: [authGuard],
    loadChildren: () => import('./features/suscripcion/suscripcion.routes').then(m => m.SUSCRIPCION_ROUTES)
  },
  {
    // Dashboard "Resumen General" multi-negocio (plan MAX). Fuera del layout
    // (sin tab bar/sidebar) — vista de analisis dedicada. authGuard (sesion) +
    // suscripcionGuard (cobro al dia); el roleGuard(['ADMIN']) va dentro de sus rutas.
    path: 'resumen-general',
    canActivate: [authGuard, suscripcionGuard],
    loadChildren: () => import('./features/grupo/grupo.routes').then(m => m.GRUPO_ROUTES)
  },
  {
    // La app del negocio: authGuard (sesion) + suscripcionGuard (cobro al dia).
    // Si la suscripcion esta bloqueada, suscripcionGuard redirige a /suscripcion.
    path: '',
    canActivate: [authGuard, suscripcionGuard],
    loadChildren: () => import('./features/layout/layout.routes').then(m => m.LAYOUT_ROUTES)
  }
];
