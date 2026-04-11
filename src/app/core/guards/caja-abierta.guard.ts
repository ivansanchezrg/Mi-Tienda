import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TurnosCajaService } from '../../features/dashboard/services/turnos-caja.service';
import { UiService } from '../services/ui.service';

/**
 * Guard que protege rutas que requieren un turno de caja abierto (ej: /pos).
 *
 * Si no hay turno activo → redirige a /home y muestra un toast explicativo.
 * Esto evita que el usuario llegue al POS por URL directa, deep-link o historial
 * cuando la caja esta cerrada.
 *
 * Usa TurnosCajaService.turnoActivo$ (estado reactivo ya cargado al login) en
 * lugar de una query fresca — es instantaneo y siempre esta sincronizado via
 * Realtime, sin agregar round-trips al guard.
 *
 * Uso en routes:
 *   canActivate: [cajaAbiertaGuard]
 */
export const cajaAbiertaGuard: CanActivateFn = async () => {
  const turnosCaja = inject(TurnosCajaService);
  const ui = inject(UiService);
  const router = inject(Router);

  // Usar el valor sincronico del BehaviorSubject — no hace query, es O(1).
  const turno = turnosCaja.turnoActivoValue;

  if (turno) return true;

  // Defensa extra: si por alguna razon el BehaviorSubject aun no tiene valor
  // (ej: guard corre antes de que inicializarEstadoReactivo() resuelva), tomar
  // el primer valor del observable. Si despues de eso sigue null, bloquear.
  const turnoAsync = await firstValueFrom(turnosCaja.turnoActivo$);
  if (turnoAsync) return true;

  await ui.showToast('Abri la caja desde Inicio para usar el POS', 'warning');
  return router.createUrlTree(['/home']);
};
