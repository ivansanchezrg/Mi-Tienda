import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../../features/auth/services/auth.service';

export const publicGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const session = await auth.getSession();

  if (!session) {
    return true;
  }

  // Sesión OAuth persistida pero sin autenticación activa (primera instalación,
  // reinstalación, etc.) → dejar ver el login para que el usuario elija cuenta.
  if (!(await auth.hasActiveAuth())) {
    return true;
  }

  return router.createUrlTree(['/caja']);
};
