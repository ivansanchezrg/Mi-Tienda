import { Injectable, inject, signal } from '@angular/core';
import { NetworkService } from '@core/services/network.service';

/**
 * Banner efímero "Conexión restablecida" — franja superior temporal que confirma
 * al usuario que la red volvió tras haber estado offline.
 *
 * Por qué banner y no overlay: la reconexión puede repetirse varias veces por turno
 * de trabajo (red parpadeante). Un overlay centrado (que exige percibirlo y
 * cerrarlo) sería la "fatiga de interrupción" que design_toast_vs_overlay_feedback.md
 * busca evitar — el banner es una franja que no bloquea nada y se auto-oculta sola.
 *
 * Mensaje genérico a propósito: el servicio es global (vive en `root`, se auto-
 * suscribe una sola vez desde su constructor) y puede reconectar estando el usuario
 * en cualquier pantalla — no solo el home. "Conexión restablecida" describe el
 * hecho de red sin prometer qué datos se refrescaron en cada pantalla.
 *
 * Por qué detecta el flanco AQUÍ y no en cada página: antes el home detectaba su
 * propio flanco offline→online y llamaba mostrar() al terminar de recargar su
 * dashboard — el banner (global) solo aparecía si el usuario estaba mirando el
 * home en el instante de la reconexión. Centralizarlo en el servicio (que ya vive
 * en root y se instancia una vez desde AppComponent) lo hace funcionar sin
 * importar qué pantalla esté activa.
 *
 * Montado una sola vez en AppComponent (mismo patrón que OfflineBannerComponent y
 * FeedbackOverlayService).
 */
@Injectable({ providedIn: 'root' })
export class SyncBannerService {
  private network = inject(NetworkService);

  readonly visible = signal(false);

  private timeout: ReturnType<typeof setTimeout> | undefined;
  /** undefined hasta el primer valor real — evita disparar en el arranque en frío. */
  private ultimoEstado?: boolean;

  /** Duración visible antes de auto-ocultarse (ms). */
  private static readonly DURACION_MS = 2500;

  constructor() {
    this.network.getNetworkStatus().subscribe(online => {
      const veniaDeOffline = this.ultimoEstado === false;
      this.ultimoEstado = online;
      if (online && veniaDeOffline) this.mostrar();
    });
  }

  private mostrar(): void {
    clearTimeout(this.timeout);
    this.visible.set(true);
    this.timeout = setTimeout(() => this.visible.set(false), SyncBannerService.DURACION_MS);
  }
}
