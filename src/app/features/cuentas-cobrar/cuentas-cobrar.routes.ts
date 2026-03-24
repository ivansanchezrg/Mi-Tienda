import { Routes } from '@angular/router';

export const CUENTAS_COBRAR_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () => import('./pages/main/cuentas-cobrar.page').then(m => m.CuentasCobrarPage)
    },
    {
        path: ':clienteId',
        loadComponent: () => import('./pages/detalle-cliente/detalle-cliente.page').then(m => m.DetalleClientePage)
    }
];
