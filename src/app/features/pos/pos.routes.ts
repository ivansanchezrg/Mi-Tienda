import { Routes } from '@angular/router';

export const POS_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () => import('./pages/pos/pos.page').then(m => m.PosPage)
    }
];
