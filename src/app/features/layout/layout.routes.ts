import { Routes } from '@angular/router';
import { MainLayoutPage } from './pages/main/main-layout.page';
import { roleGuard } from '../../core/guards/role.guard';
import { cajaAbiertaGuard } from '../../core/guards/caja-abierta.guard';

export const LAYOUT_ROUTES: Routes = [
  {
    path: '',
    component: MainLayoutPage,
    children: [
      {
        path: 'caja',
        loadChildren: () => import('../caja/caja.routes').then(m => m.CAJA_ROUTES)
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
        path: 'historial-recargas',
        loadChildren: () => import('../historial-recargas/historial-recargas.routes').then(m => m.HISTORIAL_RECARGAS_ROUTES)
      },
      {
        path: 'configuracion',
        canActivate: [roleGuard(['ADMIN'])],
        loadChildren: () => import('../configuracion/configuracion.routes').then(m => m.CONFIGURACION_ROUTES)
      },
      {
        path: 'pos',
        canActivate: [cajaAbiertaGuard],
        loadChildren: () => import('../pos/pos.routes').then(m => m.POS_ROUTES)
      },
      {
        path: 'cuentas-cobrar',
        loadChildren: () => import('../cuentas-cobrar/cuentas-cobrar.routes').then(m => m.CUENTAS_COBRAR_ROUTES)
      },
      {
        path: 'clientes',
        loadChildren: () => import('../clientes/clientes.routes').then(m => m.CLIENTES_ROUTES)
      },
      {
        path: 'notas',
        loadChildren: () => import('../notas/notas.routes').then(m => m.NOTAS_ROUTES)
      },
      {
        path: 'cuentas-corrientes',
        loadChildren: () => import('../cuentas-corrientes/cuentas-corrientes.routes').then(m => m.CUENTAS_CORRIENTES_ROUTES)
      },
      {
        path: 'movimientos-empleados',
        canActivate: [roleGuard(['ADMIN'])],
        loadChildren: () => import('../movimientos-empleados/movimientos-empleados.routes').then(m => m.MOVIMIENTOS_EMPLEADOS_ROUTES)
      },
      {
        path: '',
        redirectTo: 'caja',
        pathMatch: 'full'
      }
    ]
  }
];
