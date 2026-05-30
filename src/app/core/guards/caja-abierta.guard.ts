import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TurnosCajaService } from '../../features/caja/services/turnos-caja.service';
import { UiService } from '../services/ui.service';

/**
 * Guard que protege rutas que requieren que el usuario actual sea quien abrio
 * el turno de caja (ej: /pos).
 *
 * Solo el empleado que abrio el turno puede acceder al POS y al Cajon.
 * Los demas usuarios ven un toast explicativo y quedan en /caja.
 *
 * Espera a que inicializarEstadoReactivo() termine (esperarEstadoListo) antes
 * de decidir — evita la race condition al hacer refresh donde el BehaviorSubject
 * aun no tenia datos de BD cuando el guard corria.
 *
 * Uso en routes:
 *   canActivate: [cajaAbiertaGuard]
 */
export const cajaAbiertaGuard: CanActivateFn = async () => {
  const turnosCaja = inject(TurnosCajaService);
  const ui = inject(UiService);
  const router = inject(Router);

  // Esperar a que la query de BD termine antes de leer el estado.
  // Si ya estaba inicializado (navegacion normal), resuelve inmediatamente.
  await turnosCaja.esperarEstadoListo();

  if (turnosCaja.esMiTurnoValue) return true;

  const turno = turnosCaja.turnoActivoValue;
  if (turno) {
    const nombre = turno.empleado?.nombre ?? 'Otro empleado';
    await ui.showToast(`${nombre} ya tiene el turno abierto. Solo ${nombre} puede usar el POS`, 'warning');
  } else {
    await ui.showToast('Para usar el POS primero abre la caja desde Inicio', 'warning');
  }
  return router.createUrlTree(['/caja']);
};
