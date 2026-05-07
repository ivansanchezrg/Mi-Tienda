import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TurnosCajaService } from '../../features/caja/services/turnos-caja.service';
import { UiService } from '../services/ui.service';

/**
 * Guard que protege rutas que requieren que el usuario actual sea quien abrio
 * el turno de caja (ej: /pos).
 *
 * Solo el empleado que abrio el turno puede acceder al POS y al Cajon.
 * Los demas usuarios ven un toast explicativo y quedan en /caja.
 *
 * Usa TurnosCajaService.esMiTurnoValue (sincrono, O(1)) y cae al observable
 * como defensa si el estado aun no cargo.
 *
 * Uso en routes:
 *   canActivate: [cajaAbiertaGuard]
 */
export const cajaAbiertaGuard: CanActivateFn = async () => {
  const turnosCaja = inject(TurnosCajaService);
  const ui = inject(UiService);
  const router = inject(Router);

  if (turnosCaja.esMiTurnoValue) return true;

  // Defensa extra: si el BehaviorSubject aun no tiene valor (guard corre antes
  // de que inicializarEstadoReactivo() resuelva), esperar el primer emit.
  const esMio = await firstValueFrom(turnosCaja.esMiTurno$);
  if (esMio) return true;

  const turno = turnosCaja.turnoActivoValue;
  if (turno) {
    const nombre = turno.empleado?.nombre ?? 'Otro empleado';
    await ui.showToast(`${nombre} ya tiene el turno abierto. Solo él puede usar el POS`, 'warning');
  } else {
    await ui.showToast('Abrí la caja desde Inicio para usar el POS', 'warning');
  }
  return router.createUrlTree(['/caja']);
};
