import { Injectable, signal } from '@angular/core';

export type FeedbackOverlayTipo = 'success' | 'error' | 'warning' | 'info';

export interface FeedbackOverlayData {
    tipo: FeedbackOverlayTipo;
    /** Título principal — obligatorio, es lo primero que lee el usuario. */
    titulo: string;
    /** Dato destacado (monto, cantidad, código) en tipografía grande. Opcional. */
    destacado?: string;
    /** Línea secundaria bajo el destacado (comprobante, aclaración). Opcional. */
    subtitulo?: string;
    /** Nombre de ionicon a mostrar en vez del ícono default del tipo. Opcional. */
    icono?: string;
    /**
     * Auto-cierre en ms. `0` desactiva el auto-cierre (requiere tap/botón para cerrar).
     * Default por tipo si se omite: success/info = 3000ms, warning/error = 0 (el
     * usuario debe leer y cerrar — un error nunca debería desaparecer solo).
     */
    duracionMs?: number;
}

/**
 * FeedbackOverlayService — overlay centrado, breve y de alto impacto para momentos
 * que necesitan un cierre visual inequívoco (p.ej. "venta registrada"). NO reemplaza
 * a UiService.showToast()/showError(): sigue siendo el default para el 95% de los
 * mensajes. Usar este overlay solo para eventos "de ley" — la finalización de una
 * operación importante que el usuario debe percibir sin ambigüedad, no para
 * confirmaciones rutinarias (guardar un campo, aplicar un filtro, etc.).
 *
 * Regla de auto-dismiss (por qué success/info sí y warning/error no por default):
 *   success/info son notificaciones de UN estado que ya ocurrió y no requiere acción
 *   — el usuario solo necesita percibirlo. warning/error casi siempre requieren LEER
 *   la causa o decidir algo; auto-ocultarlos arriesga que el usuario pierda el motivo
 *   del problema. Sigue siendo posible forzar duracionMs > 0 en un warning puntual,
 *   pero el default protege contra el mal uso.
 *
 * Montado una sola vez en AppComponent (mismo patrón que OfflineBannerComponent) —
 * los callers solo inyectan el servicio, nunca declaran el componente.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackOverlayService {
    readonly estado = signal<FeedbackOverlayData | null>(null);

    private timeout: ReturnType<typeof setTimeout> | undefined;

    private static readonly DURACION_DEFAULT: Record<FeedbackOverlayTipo, number> = {
        success: 3000,
        info: 3000,
        warning: 0,
        error: 0,
    };

    mostrar(data: FeedbackOverlayData) {
        clearTimeout(this.timeout);
        // Resuelve la duración efectiva ANTES de guardar el estado — el componente lee
        // duracionMs ya resuelto (nunca undefined), así no duplica la tabla de defaults.
        const duracion = data.duracionMs ?? FeedbackOverlayService.DURACION_DEFAULT[data.tipo];
        this.estado.set({ ...data, duracionMs: duracion });

        if (duracion > 0) {
            this.timeout = setTimeout(() => this.cerrar(), duracion);
        }
    }

    success(data: Omit<FeedbackOverlayData, 'tipo'>) {
        this.mostrar({ ...data, tipo: 'success' });
    }

    error(data: Omit<FeedbackOverlayData, 'tipo'>) {
        this.mostrar({ ...data, tipo: 'error' });
    }

    warning(data: Omit<FeedbackOverlayData, 'tipo'>) {
        this.mostrar({ ...data, tipo: 'warning' });
    }

    info(data: Omit<FeedbackOverlayData, 'tipo'>) {
        this.mostrar({ ...data, tipo: 'info' });
    }

    cerrar() {
        clearTimeout(this.timeout);
        this.estado.set(null);
    }
}
