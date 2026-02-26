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
    path: 'operaciones-caja',
    loadComponent: () => import('./pages/operaciones-caja/operaciones-caja.page').then(m => m.OperacionesCajaPage)
  },
  {
    path: 'gastos-diarios',
    loadComponent: () => import('../gastos-diarios/pages/gastos-diarios/gastos-diarios.page').then(m => m.GastosDiariosPage)
  },
  {
    path: 'historial-recargas',
    loadComponent: () => import('./pages/historial-recargas/historial-recargas.page').then(m => m.HistorialRecargasPage)
  },
  {
    path: 'recargas-virtuales',
    loadComponent: () => import('../recargas-virtuales/pages/recargas-virtuales/recargas-virtuales.page').then(m => m.RecargasVirtualesPage)
  },
  {
    path: 'pagar-deudas',
    loadComponent: () => import('../recargas-virtuales/pages/pagar-deudas/pagar-deudas.page').then(m => m.PagarDeudasPage)
  }
];

