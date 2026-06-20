import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SuscripcionService } from '../services/suscripcion.service';
import { AuthService } from '../../features/auth/services/auth.service';
import { ROUTES } from '../config/routes.config';

/**
 * Guard que bloquea el acceso a la app cuando la suscripción del negocio está
 * bloqueada (vencida, suspendida o cancelada). Redirige a la pantalla "Suscríbete".
 *
 * Responsabilidad única: valida SOLO la suscripción. Se compone en cadena DESPUÉS
 * de authGuard (que ya garantizó sesión + negocio activo). No se mezcla con authGuard
 * para no convertirlo en un "god guard" — ver docs/PLAN-PLANES-SUSCRIPCION.md §4.1.
 *
 * Exenciones:
 *  - Superadmin: nunca se bloquea (entra a los negocios para dar soporte).
 *  - Fail-open: si SuscripcionService no pudo leer el estado (sin red/error), deja
 *    pasar. El servicio devuelve { bloqueada: false } ante error, así que el usuario
 *    nunca queda encerrado por un fallo de conexión.
 *
 * Uso en routes:
 *   canActivate: [authGuard, suscripcionGuard]
 */
export const suscripcionGuard: CanActivateFn = async () => {
  const suscripcion = inject(SuscripcionService);
  const auth = inject(AuthService);
  const router = inject(Router);

  // El superadmin opera dentro de cualquier negocio para soporte — nunca bloqueado.
  if (auth.usuarioActualValue?.es_superadmin) return true;

  const estado = await suscripcion.getEstado();
  if (estado.bloqueada) {
    return router.createUrlTree([ROUTES.suscripcion]);
  }
  return true;
};
