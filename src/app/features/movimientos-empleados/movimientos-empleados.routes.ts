import { Routes } from '@angular/router';

export const MOVIMIENTOS_EMPLEADOS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pages/lista/movimientos-empleados-lista.page')
      .then(m => m.MovimientosEmpleadosListaPage)
  },
  {
    path: ':empleadoId',
    loadComponent: () => import('./pages/detalle/movimientos-empleado-detalle.page')
      .then(m => m.MovimientosEmpleadoDetallePage)
  }
];
