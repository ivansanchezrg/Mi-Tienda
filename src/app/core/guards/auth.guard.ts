import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Network } from '@capacitor/network';
import { AuthService } from '../../features/auth/services/auth.service';
import { UiService } from '../services/ui.service';
import { LoggerService } from '../services/logger.service';

export const authGuard: CanActivateFn = async (_route, state) => {
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
    // Si hay sesión OAuth persistida pero el usuario nunca eligió su cuenta
    // activamente en esta instalación (flag en Preferences), redirigir al login.
    // Esto cubre: reinstalación, desinstalación+instalación, primer uso.
    // El flag se escribe al completar OAuth (activarNegocio / onboarding nuevo usuario).
    // El flag se borra en logout — usuarios que ya eligieron su cuenta no se ven afectados.
    if (!auth.yaValidadoEnEstaSesion && !(await auth.hasActiveAuth())) {
      logger.info('authGuard', 'Sesión persistida sin autenticación activa → login');
      return router.createUrlTree(['/auth/login']);
    }

    // Primera navegación de la sesión: validar contra BD para detectar
    // desactivaciones que ocurrieron mientras la app estaba cerrada.
    // Navegaciones siguientes: confiar en cache + Realtime (cero queries extra).
    if (!auth.yaValidadoEnEstaSesion) {
      const isValid = await auth.validarUsuario();
      if (!isValid) {
        // validarUsuario() ya redirigió a /auth/pending o /auth/login según el caso
        return false;
      }
    }

    // Superadmin sin negocio activo no debe navegar por la app de negocio.
    // Si llega aquí directamente (ej: escribe /caja en la URL), mandarlo al panel admin.
    const usuario = await auth.getUsuarioActual();

    // Preferences vacío con sesión activa → reconstruir estado via validarUsuario()
    if (!usuario) {
      logger.warn('authGuard', 'Sin UsuarioActual en cache — reconstruyendo estado');
      await auth.validarUsuario();
      return false; // validarUsuario() ya navegó al destino correcto
    }

    // Superadmin sin negocio activo: solo puede navegar /admin y /crear-negocio.
    // Si intenta entrar a la app del negocio (/caja, /ventas, etc.) lo mandamos al panel admin.
    // /crear-negocio es legitimo para el superadmin (crea sucursales para terceros desde /admin).
    if (usuario.es_superadmin && !usuario.negocio_id) {
      const url = state.url;
      const rutasPermitidas = url.startsWith('/admin') || url.startsWith('/crear-negocio');
      if (!rutasPermitidas) {
        logger.info('authGuard', `Superadmin sin negocio activo intento ir a ${url} -> panel admin`);
        return router.createUrlTree(['/admin']);
      }
    }

    return true;
  }

  logger.warn('authGuard', 'Sin sesión válida → login');
  return router.createUrlTree(['/auth/login']);
};
