import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../../features/auth/services/auth.service';
import { LoggerService } from '../services/logger.service';

/**
 * Guard exclusivo del panel de superadmin (/admin).
 * Verifica que el usuario tenga es_superadmin = true.
 * Si no → redirige a /home (ya autenticado pero sin privilegios).
 * Si no hay sesión → redirige a /auth/login.
 *
 * Si Preferences está vacío pero hay sesión activa (ej: primera carga tras login
 * o Preferences borrado), corre validarUsuario() para reconstruir el estado.
 * validarUsuario() redirige por sí mismo al destino correcto, así que se
 * retorna false para que este guard no navegue encima.
 */
export const superadminGuard: CanActivateFn = async () => {
  const auth   = inject(AuthService);
  const router = inject(Router);
  const logger = inject(LoggerService);

  const session = await auth.getSession();
  if (!session) {
    logger.warn('superadminGuard', 'Sin sesión → login');
    return router.createUrlTree(['/auth/login']);
  }

  const usuario = await auth.getUsuarioActual();

  // Preferences vacío con sesión activa → reconstruir estado via validarUsuario()
  if (!usuario) {
    logger.warn('superadminGuard', 'Sin UsuarioActual en cache — reconstruyendo estado');
    await auth.validarUsuario();
    return false; // validarUsuario() ya navegó al destino correcto
  }

  if (!usuario.es_superadmin) {
    logger.warn('superadminGuard', 'Acceso denegado al panel admin → home');
    return router.createUrlTree(['/home']);
  }

  return true;
};
