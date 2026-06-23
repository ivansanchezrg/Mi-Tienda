import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Network } from '@capacitor/network';
import { AuthService } from '../../features/auth/services/auth.service';
import { UiService } from '../services/ui.service';
import { LoggerService } from '../services/logger.service';
import { SupabaseService } from '../services/supabase.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const ui = inject(UiService);
  const logger = inject(LoggerService);
  const supabase = inject(SupabaseService);

  // Si hay un resume-refresh en curso (token expirado al volver del background),
  // esperarlo antes de llamar getSession() — evita que Supabase serialice dos
  // refresh en paralelo, que es lo que causa el freeze de 4-5s tras inactividad larga.
  if (supabase.resumeRefreshInFlight) {
    logger.info('authGuard', 'Esperando resume-refresh en curso...');
    await supabase.resumeRefreshInFlight;
  }

  const status = await Network.getStatus();

  if (!status.connected) {
    if (auth.hasLocalSession()) {
      // Offline: usuarios.activo eliminado (2026-06-16) — la suspensión por cobro
      // (suscripciones) y por membresía no se pueden validar offline; fail-open.
      const usuario = await auth.getUsuarioActual();
      // Emitir el usuario del cache en usuarioActual$ (sin Realtime, no hay red).
      // Despierta la cadena reactiva dependiente del usuario — sin esto, offline
      // TurnosCajaService nunca recibe el usuario y esMiTurno queda en false hasta
      // reiniciar la app, rompiendo el botón Abrir/Cerrar del home al volver la red.
      if (usuario) auth.hidratarUsuarioOffline(usuario);
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

    if (!auth.yaValidadoEnEstaSesion) {
      // Fast path: JWT válido + UsuarioActual en cache → acceso inmediato.
      // La validación contra BD corre en background para detectar suspensiones
      // ocurridas mientras la app estaba cerrada. Si detecta algo, los canales
      // Realtime (ya abiertos por iniciarRealtimeUsuario) redirigen al usuario.
      const cachedUsuario = await auth.getUsuarioActual();

      if (cachedUsuario) {
        logger.info('authGuard', 'Fast path: JWT + cache válidos — acceso inmediato');
        // Iniciar Realtime antes de soltar el guard para que la protección
        // por desactivación esté activa desde el primer render.
        auth.iniciarRealtimeDesdeCache(cachedUsuario);

        // Validación background: no bloquea la navegación
        auth.validarUsuarioBackground();

        // Superadmin sin negocio activo: redirigir al panel admin
        if (cachedUsuario.es_superadmin && !cachedUsuario.negocio_id) {
          const url = state.url;
          const rutasPermitidas = url.startsWith('/admin') || url.startsWith('/crear-negocio');
          if (!rutasPermitidas) {
            logger.info('authGuard', `Superadmin sin negocio activo → panel admin`);
            return router.createUrlTree(['/admin']);
          }
        }

        return true;
      }

      // Sin cache: flujo completo síncrono (primera instalación, logout, JWT expirado)
      logger.info('authGuard', 'Sin cache — validación completa contra BD');
      const isValid = await auth.validarUsuario();
      if (!isValid) {
        // validarUsuario() ya redirigió a /auth/pending o /auth/login según el caso
        return false;
      }
    }

    // Sesión ya validada en esta sesión (navegaciones posteriores al arranque)
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
