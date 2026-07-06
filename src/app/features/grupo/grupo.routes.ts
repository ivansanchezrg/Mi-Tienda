import { Routes } from '@angular/router';
import { roleGuard } from '../../core/guards/role.guard';

/**
 * Rutas del módulo Grupo — dashboard "Resumen General" multi-negocio (plan MAX).
 * Vive FUERA del layout (sin tab bar/sidebar): es una vista de análisis dedicada,
 * no de operación. Protegida por roleGuard(['ADMIN']) — solo el admin del negocio
 * accede; el gate de plan MAX + 2 negocios lo aplica el selector de negocios que
 * navega aquí. authGuard se aplica en app.routes.ts (padre).
 */
export const GRUPO_ROUTES: Routes = [
  {
    path: '',
    canActivate: [roleGuard(['ADMIN'])],
    loadComponent: () =>
      import('./pages/resumen-general/resumen-general.page').then(m => m.ResumenGeneralPage),
  },
];
