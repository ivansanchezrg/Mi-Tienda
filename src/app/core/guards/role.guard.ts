import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../../features/auth/services/auth.service';
import { RolUsuario } from '../../features/auth/models/usuario_actual.model';

/**
 * Guard de roles. Verifica que el usuario tenga uno de los roles permitidos.
 * Si no tiene acceso → redirige a /home (no al login, ya está autenticado).
 *
 * Uso en routes:
 *   canActivate: [roleGuard(['ADMIN'])]
 *   canActivate: [roleGuard(['ADMIN', 'EMPLEADO'])]
 */
export const roleGuard = (rolesPermitidos: RolUsuario[]): CanActivateFn => async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const usuario = await auth.getUsuarioActual();

  if (!usuario || !rolesPermitidos.includes(usuario.rol)) {
    return router.createUrlTree(['/home']);
  }

  return true;
};
