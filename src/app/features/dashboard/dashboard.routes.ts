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
  },
  {
    path: 'transferir-ganancias',
    loadComponent: () => import('./pages/transferir-ganancias/transferir-ganancias.page').then(m => m.TransferirGananciasPage)
  },
  {
    path: 'operaciones-caja',
    loadComponent: () => import('./pages/operaciones-caja/operaciones-caja.page').then(m => m.OperacionesCajaPage)
  },
  {
    path: 'cuadre-caja',
    loadComponent: () => import('./pages/cuadre-caja/cuadre-caja.page').then(m => m.CuadreCajaPage)
  },
  {
    path: 'gastos-diarios',
    loadComponent: () => import('./pages/gastos-diarios/gastos-diarios.page').then(m => m.GastosDiariosPage)
  },
  {
    path: 'historial-recargas',
    loadComponent: () => import('./pages/historial-recargas/historial-recargas.page').then(m => m.HistorialRecargasPage)
  }
];
