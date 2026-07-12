/** Mínimo común entre IonContent y ElementRef<HTMLIonContentElement>: ambos exponen
 *  scrollToTop(ms) en runtime (es el mismo custom element), pero con tipos TS distintos
 *  según cómo cada página declaró su @ViewChild — algunas leen el componente Angular
 *  (IonContent), otras el elemento nativo ({ read: ElementRef }). Este tipo estructural
 *  acepta ambos sin forzar a ninguna página a cambiar su @ViewChild existente. */
export interface ScrollableIonContent {
    scrollToTop(durationMs?: number): Promise<void>;
}

/**
 * Controller reutilizable de "subir al inicio" para páginas con listas/grids largos
 * dentro de un ion-content. Encapsula el estado (showScrollTop) y los dos handlers
 * (onContentScroll, scrollToTop) que antes se copiaban a mano en cada página —
 * PosPage, HistorialTurnosPage, OperacionesCajaPage y PaginatedListPage tenían el
 * mismo código con ligeras variaciones (distinta duración de animación, distinto
 * umbral de scroll).
 *
 * Por qué composición y no herencia: cada consumidor ya tiene su propia cadena de
 * herencia/lifecycle (PosPage implementa 4 interfaces, PaginatedListPage es la base
 * de listados paginados). TypeScript no permite heredar de 2 clases — un controller
 * inyectable por composición no compite con eso.
 *
 * Uso:
 * ```ts
 * @ViewChild(IonContent) content!: IonContent; // o el que ya tenga la página
 * readonly scrollTop = crearScrollToTop(() => this.content);
 * ```
 * Template:
 * ```html
 * <ion-content [scrollEvents]="true" (ionScroll)="scrollTop.onContentScroll($event)">
 *   ...
 *   @if (scrollTop.showScrollTop) {
 *   <ion-fab vertical="bottom" horizontal="end" slot="fixed" class="scroll-top-fab">
 *     <ion-fab-button size="small" color="primary" (pointerdown)="scrollTop.scrollToTop()">
 *       <ion-icon name="arrow-up-outline"></ion-icon>
 *     </ion-fab-button>
 *   </ion-fab>
 *   }
 * </ion-content>
 * ```
 * (pointerdown) en vez de (click): con la lista aún deslizándose por inercia (momentum
 * scroll), el WebView consume el primer toque solo para detener el scroll y no dispara
 * "click" — el usuario necesitaba tocar 2 veces. pointerdown llega ANTES de ese ciclo,
 * así el primer toque ya frena el scroll Y navega.
 */
export interface ScrollToTopController {
    /** Muestra el FAB cuando el usuario bajó lo suficiente. Signal-like: leer directo en el template. */
    showScrollTop: boolean;
    /** Handler de (ionScroll) — actualiza showScrollTop según la posición. */
    onContentScroll(event: CustomEvent): void;
    /** Sube al inicio del content con animación. */
    scrollToTop(): void;
    /** Oculta el FAB sin animar — para cuando la página cambia de sub-vista/categoría
     *  y el nuevo contenido arranca desde arriba (el próximo (ionScroll) ya lo re-mostrará
     *  si corresponde). Ej.: PosPage al cambiar de categoría o salir del catálogo. */
    reset(): void;
}

/**
 * @param obtenerContent función que retorna el IonContent actual (permite pasar un
 *   @ViewChild que aún no esté resuelto en el momento de crear el controller).
 * @param umbralPx a partir de qué scrollTop se muestra el FAB (default 600, el mismo
 *   que ya usaban todos los consumidores).
 * @param duracionMs duración de la animación de scrollToTop (default 400ms).
 */
export function crearScrollToTop(
    obtenerContent: () => ScrollableIonContent | null | undefined,
    umbralPx = 600,
    duracionMs = 400
): ScrollToTopController {
    return {
        showScrollTop: false,
        onContentScroll(event: CustomEvent) {
            this.showScrollTop = event.detail.scrollTop > umbralPx;
        },
        scrollToTop() {
            obtenerContent()?.scrollToTop(duracionMs);
        },
        reset() {
            this.showScrollTop = false;
        },
    };
}
