import { Routes } from '@angular/router';

export const NOTAS_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () => import('./pages/list/notas-list.page').then(m => m.NotasListPage)
    }
];
