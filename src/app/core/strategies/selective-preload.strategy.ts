import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { Observable, of, timer } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

/**
 * Estrategia de preload selectiva.
 *
 * Solo precarga rutas marcadas con `data: { preload: true }`. Adicionalmente
 * espera 2 segundos tras el bootstrap para no competir con el render inicial
 * del home (queries paralelas, Realtime channels, primer paint).
 *
 * Patrón "idle preload": las rutas marcadas se descargan en background cuando
 * el usuario está mirando el home; cuando navega a esas rutas el chunk ya está
 * en memoria → navegación instantánea.
 *
 * Marcar una ruta para preload:
 * ```ts
 * {
 *   path: 'ventas',
 *   data: { preload: true },
 *   loadChildren: () => import('../ventas/ventas.routes').then(m => m.VENTAS_ROUTES)
 * }
 * ```
 *
 * Rutas NO marcadas (admin, configuracion, notas, etc.) siguen cargando on-demand.
 */
@Injectable({ providedIn: 'root' })
export class SelectivePreloadStrategy implements PreloadingStrategy {

    /** Delay tras bootstrap antes de empezar a precargar. Da espacio al render del home. */
    private readonly DELAY_MS = 2000;

    preload(route: Route, load: () => Observable<any>): Observable<any> {
        if (route.data?.['preload'] === true) {
            // Espera al idle estimado y precarga
            return timer(this.DELAY_MS).pipe(mergeMap(() => load()));
        }
        return of(null);
    }
}
