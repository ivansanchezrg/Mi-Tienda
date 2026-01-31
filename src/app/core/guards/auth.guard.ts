import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Network } from '@capacitor/network';
import { AuthService } from '../../features/auth/services/auth.service';
import { UiService } from '../services/ui.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const ui = inject(UiService);

  const status = await Network.getStatus();

  if (!status.connected) {
    // Sin internet: verificar si hay sesión local guardada
    if (auth.hasLocalSession()) {
      ui.showToast('Sin conexión a internet', 'warning');
      return true;
    }
    return router.createUrlTree(['/auth/login']);
  }

  // Con internet: verificar sesión normalmente
  const session = await auth.getSession();

  if (session) {
    return true;
  }

  return router.createUrlTree(['/auth/login']);
};
