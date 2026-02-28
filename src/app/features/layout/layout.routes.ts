import { Routes } from '@angular/router';
import { MainLayoutPage } from './pages/main/main-layout.page';
import { roleGuard } from '../../core/guards/role.guard';

export const LAYOUT_ROUTES: Routes = [
  {
    path: '',
    component: MainLayoutPage,
    children: [
      {
        path: 'home',
        loadChildren: () => import('../dashboard/dashboard.routes').then(m => m.DASHBOARD_ROUTES)
      },
      {
        path: 'usuarios',
        canActivate: [roleGuard(['ADMIN'])],
        loadChildren: () => import('../usuarios/usuarios.routes').then(m => m.USUARIOS_ROUTES)
      },
      {
        path: 'ventas',
        loadChildren: () => import('../ventas/ventas.routes').then(m => m.VENTAS_ROUTES)
      },
      {
        path: 'inventario',
        loadChildren: () => import('../inventario/inventario.routes').then(m => m.INVENTARIO_ROUTES)
      },
      {
        path: 'reportes',
        loadChildren: () => import('../reportes/reportes.routes').then(m => m.REPORTES_ROUTES)
      },
      {
        path: 'configuracion',
        canActivate: [roleGuard(['ADMIN'])],
        loadChildren: () => import('../configuracion/configuracion.routes').then(m => m.CONFIGURACION_ROUTES)
      },
      {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full'
      }
    ]
  }
];
