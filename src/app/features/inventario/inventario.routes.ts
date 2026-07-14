import { Routes } from '@angular/router';
import { pendingChangesGuard } from '../../core/guards/pending-changes.guard';

export const INVENTARIO_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/main/inventario.page').then(m => m.InventarioPage)
  },
  {
    path: 'nuevo',
    loadComponent: () => import('./pages/producto-crear/producto-crear.page').then(m => m.ProductoCrearPage),
    canDeactivate: [pendingChangesGuard]
  },
  {
    path: 'editar/:id',
    loadComponent: () => import('./pages/producto-editar/producto-editar.page').then(m => m.ProductoEditarPage)
  },
  {
    path: 'template/:id',
    loadComponent: () => import('./pages/template-editar/template-editar.page').then(m => m.TemplateEditarPage),
    canDeactivate: [pendingChangesGuard]
  },
  {
    path: 'kardex/:id',
    loadComponent: () => import('./pages/kardex/kardex.page').then(m => m.KardexPage)
  }
];
