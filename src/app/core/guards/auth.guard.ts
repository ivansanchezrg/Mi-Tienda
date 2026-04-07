import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Network } from '@capacitor/network';
import { AuthService } from '../../features/auth/services/auth.service';
import { UiService } from '../services/ui.service';
import { LoggerService } from '../services/logger.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const ui = inject(UiService);
  const logger = inject(LoggerService);

  const status = await Network.getStatus();

  if (!status.connected) {
    if (auth.hasLocalSession()) {
      // Offline: verificar que el usuario cacheado esté activo
      const usuario = await auth.getUsuarioActual();
      if (usuario && !usuario.activo) {
        logger.warn('authGuard', 'Usuario inactivo (offline) → pending');
        return router.createUrlTree(['/auth/pending']);
      }
      logger.info('authGuard', 'Acceso offline con sesión local');
      ui.showToast('Sin conexión a internet', 'warning');
      return true;
    }
    logger.warn('authGuard', 'Sin internet y sin sesión local → login');
    return router.createUrlTree(['/auth/login']);
  }

  const session = await auth.getSession();

  if (session) {
    // Online: verificar que el usuario cacheado esté activo
    const usuario = await auth.getUsuarioActual();
    if (usuario && !usuario.activo) {
      logger.warn('authGuard', 'Usuario inactivo → pending');
      return router.createUrlTree(['/auth/pending']);
    }
    return true;
  }

  logger.warn('authGuard', 'Sin sesión válida → login');
  return router.createUrlTree(['/auth/login']);
};
