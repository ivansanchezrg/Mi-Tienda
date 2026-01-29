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

  return router.createUrlTree(['/home']);
};
