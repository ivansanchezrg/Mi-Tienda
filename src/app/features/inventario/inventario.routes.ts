import { Routes } from '@angular/router';

export const INVENTARIO_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/main/inventario.page').then(m => m.InventarioPage)
  },
  {
    path: 'nuevo',
    loadComponent: () => import('./pages/selector-tipo/selector-tipo.page').then(m => m.SelectorTipoPage)
  },
  {
    path: 'nuevo-simple',
    loadComponent: () => import('./pages/producto-form/producto-form.page').then(m => m.ProductoFormPage)
  },
  {
    path: 'nuevo-variantes',
    loadComponent: () => import('./pages/producto-variantes/producto-variantes.page').then(m => m.ProductoVariantesPage)
  },
  {
    path: 'editar/:id',
    loadComponent: () => import('./pages/producto-form/producto-form.page').then(m => m.ProductoFormPage)
  },
  {
    path: 'kardex/:id',
    loadComponent: () => import('./pages/kardex/kardex.page').then(m => m.KardexPage)
  }
];
