import { Directive, ElementRef, inject, ViewChild } from '@angular/core';
import { addIcons } from 'ionicons';
import { arrowUpOutline } from 'ionicons/icons';
import { UiService } from '../../core/services/ui.service';

/**
 * Clase base para páginas con listado paginado + infinite scroll + scroll-to-top.
 *
 * Uso:
 *   1. Extender esta clase en la página.
 *   2. Implementar `pageSize` y `fetchPage(page)`.
 *   3. En el template, usar `items` + los métodos heredados.
 *   4. Llamar `this.cargar()` para cargar/recargar desde página 0.
 *   5. Agregar en el HTML: `<ion-content #content [scrollEvents]="true" (ionScroll)="onContentScroll($event)">`
 *   6. Agregar antes de cerrar ion-content el bloque del FAB scroll-to-top (ver abajo).
 *
 * Template del FAB (copiar antes de </ion-content>):
 * ```html
 * @if (showScrollTop) {
 * <ion-fab vertical="bottom" horizontal="end" slot="fixed" class="scroll-top-fab">
 *   <ion-fab-button size="small" color="primary" (click)="scrollToTop()">
 *     <ion-icon name="arrow-up-outline"></ion-icon>
 *   </ion-fab-button>
 * </ion-fab>
 * }
 * ```
 *
 * La subclase NO necesita declarar: loading, hasMore, cargarMas, handleRefresh,
 * showScrollTop, onContentScroll, scrollToTop.
 */
@Directive()
export abstract class PaginatedListPage<T> {

    @ViewChild('content', { read: ElementRef }) private contentRef!: ElementRef;

    protected ui = inject(UiService);

    /** Items cargados acumulados (todas las páginas) */
    items: T[] = [];

    /** Muestra skeleton en la primera carga */
    loading = false;

    /** Controla si el infinite scroll sigue activo */
    hasMore = false;

    /** Muestra el FAB de scroll-to-top cuando el usuario baja lo suficiente */
    showScrollTop = false;

    private _page = 0;

    /** Registros por página — debe definirlo cada subclase */
    protected abstract readonly pageSize: number;

    /** Texto del spinner de infinite scroll — debe definirlo cada subclase */
    abstract readonly loadingMoreText: string;

    constructor() {
        addIcons({ arrowUpOutline });
    }

    /**
     * Obtiene una página de datos desde el origen.
     * La subclase implementa aquí la llamada al servicio.
     */
    protected abstract fetchPage(page: number): Promise<T[]>;

    /**
     * Carga desde página 0 (reset completo).
     * @param silencioso  true → no muestra spinner (para pull-to-refresh)
     */
    protected async cargar(silencioso = false): Promise<void> {
        if (!silencioso) this.loading = true;
        this._page = 0;
        try {
            const data = await this.fetchPage(0);
            this.items = data;
            this.hasMore = data.length === this.pageSize;
        } catch {
            // showError silencia el toast cuando es por falta de red (el banner global ya avisa).
            await this.ui.showError('Error al cargar los datos. Verifica tu conexión.');
        } finally {
            this.loading = false;
        }
    }

    /** Handler del ion-infinite-scroll: carga la siguiente página y la acumula */
    async cargarMas(event: CustomEvent): Promise<void> {
        this._page++;
        try {
            const mas = await this.fetchPage(this._page);
            this.items = [...this.items, ...mas];
            this.hasMore = mas.length === this.pageSize;
        } catch {
            await this.ui.showToast('Error al cargar más datos', 'danger');
        } finally {
            (event.target as HTMLIonInfiniteScrollElement).complete();
        }
    }

    /** Handler del ion-refresher: recarga desde página 0 sin spinner */
    async handleRefresh(event: CustomEvent): Promise<void> {
        await this.cargar(true);
        (event.target as HTMLIonRefresherElement).complete();
    }

    // ── Scroll-to-top ──────────────────────────────────────────────────

    /** Handler de (ionScroll): muestra/oculta el FAB según posición */
    onContentScroll(event: CustomEvent): void {
        this.showScrollTop = event.detail.scrollTop > 600;
    }

    /** Sube al inicio con animación */
    scrollToTop(): void {
        this.contentRef?.nativeElement?.scrollToTop?.(400);
    }
}
