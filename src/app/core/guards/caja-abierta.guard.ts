import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TurnosCajaService } from '../../features/caja/services/turnos-caja.service';
import { TurnoLocalService } from '../services/turno-local.service';
import { NetworkService } from '../services/network.service';
import { AuthService } from '../../features/auth/services/auth.service';
import { UiService } from '../services/ui.service';

/**
 * Guard que protege rutas que requieren que el usuario actual sea quien abrio
 * el turno de caja (ej: /pos).
 *
 * Solo el empleado que abrio el turno puede acceder al POS y al Cajon.
 * Los demas usuarios ven un toast explicativo y quedan en /caja.
 *
 * Espera a que inicializarEstadoReactivo() termine (esperarEstadoListo) antes
 * de decidir — evita la race condition al hacer refresh donde el BehaviorSubject
 * aun no tenia datos de BD cuando el guard corria.
 *
 * Offline: el estado reactivo se llena con una query a BD que sin red queda en null.
 * Para no bloquear el POS con un turno realmente abierto, se cae al snapshot local
 * (turno_activo_local, escrito al abrir turno con red). Ver §4.6 PLAN-OFFLINE-POS.
 *
 * Uso en routes:
 *   canActivate: [cajaAbiertaGuard]
 */
export const cajaAbiertaGuard: CanActivateFn = async () => {
  const turnosCaja = inject(TurnosCajaService);
  const turnoLocal = inject(TurnoLocalService);
  const network = inject(NetworkService);
  const auth = inject(AuthService);
  const ui = inject(UiService);
  const router = inject(Router);

  // Esperar a que la query de BD termine antes de leer el estado.
  // Si ya estaba inicializado (navegacion normal), resuelve inmediatamente.
  await turnosCaja.esperarEstadoListo();

  if (turnosCaja.esMiTurnoValue) return true;

  // Online con turno de otro empleado → bloquear con el mensaje correspondiente.
  const turno = turnosCaja.turnoActivoValue;
  if (turno) {
    const nombre = turno.empleado?.nombre ?? 'Otro empleado';
    await ui.showToast(`${nombre} ya tiene el turno abierto. Solo ${nombre} puede usar el POS`, 'warning');
    return router.createUrlTree(['/caja']);
  }

  // Sin turno en memoria: si es por falta de red, caer al snapshot local.
  // Solo permite el acceso si el turno cacheado es del propio usuario.
  if (!network.isConnected()) {
    const snapshot = await turnoLocal.obtener();
    if (snapshot && snapshot.empleadoId === auth.usuarioActualValue?.id) {
      return true;
    }
  }

  await ui.showToast('Para usar el POS primero abre la caja desde Inicio', 'warning');
  return router.createUrlTree(['/caja']);
};
