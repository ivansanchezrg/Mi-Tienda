import { Routes } from '@angular/router';

export const HISTORIAL_RECARGAS_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () => import('./pages/historial-recargas/historial-recargas.page').then(m => m.HistorialRecargasPage)
    }
];
