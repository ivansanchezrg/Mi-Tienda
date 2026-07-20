import { Directive, ElementRef, inject, ViewChild } from '@angular/core';
import { addIcons } from 'ionicons';
import { arrowUpOutline } from 'ionicons/icons';
import { UiService } from '../../core/services/ui.service';
import { crearScrollToTop } from '../utils/scroll-to-top.util';

/**
 * Clase base para páginas con listado paginado + infinite scroll + scroll-to-top.
 *
 * Uso:
 *   1. Extender esta clase en la página.
 *   2. Implementar `pageSize` y `fetchPage(page)`.
 *   3. En el template, usar `items` + los métodos heredados.
 *   4. Llamar `this.cargar()` para cargar/recargar desde página 0.
 *   5. Agregar en el HTML: `<ion-content #content [scrollEvents]="true" (ionScroll)="scrollTop.onContentScroll($event)">`
 *   6. Agregar antes de cerrar ion-content el bloque del FAB scroll-to-top (ver abajo).
 *
 * Template del FAB (copiar antes de </ion-content>):
 * ```html
 * @if (scrollTop.showScrollTop) {
 * <ion-fab vertical="bottom" horizontal="end" slot="fixed" class="scroll-top-fab">
 *   <ion-fab-button size="small" color="primary" (pointerdown)="scrollTop.scrollToTop()">
 *     <ion-icon name="arrow-up-outline"></ion-icon>
 *   </ion-fab-button>
 * </ion-fab>
 * }
 * ```
 * Y en el (ionScroll) del ion-content: `(ionScroll)="scrollTop.onContentScroll($event)"`.
 *
 * (pointerdown) en vez de (click): con la lista aún deslizándose por inercia (momentum
 * scroll), el WebView consume el primer toque solo para detener el scroll y no dispara
 * "click" — el usuario necesitaba tocar 2 veces. pointerdown llega ANTES de ese ciclo,
 * así el primer toque ya frena el scroll Y navega.
 *
 * La subclase NO necesita declarar: loading, hasMore, cargarMas, handleRefresh, scrollTop.
 */
@Directive()
export abstract class PaginatedListPage<T> {

    @ViewChild('content', { read: ElementRef }) private contentRef!: ElementRef;

    protected ui = inject(UiService);

    /** Controller de scroll-to-top (showScrollTop, onContentScroll, scrollToTop) —
     *  compartido con PosPage y otras páginas que no pueden heredar de esta clase. */
    readonly scrollTop = crearScrollToTop(() => this.contentRef?.nativeElement);

    /** Items cargados acumulados (todas las páginas) */
    items: T[] = [];

    /** Muestra skeleton en la primera carga */
    loading = false;

    /** Controla si el infinite scroll sigue activo */
    hasMore = false;

    private _page = 0;

    /**
     * Token de generación de la carga. Cada `cargar()` (reset por filtro/búsqueda/refresh)
     * lo incrementa. Los resultados de un `fetchPage` en vuelo se DESCARTAN si su generación
     * ya no es la vigente al resolver → evita la carrera clásica: el usuario cambia de filtro
     * mientras un `cargarMas` está esperando, y al llegar tarde ese `cargarMas` mezclaba
     * productos del filtro viejo, dejaba `hasMore`/`_page` desincronizados y el infinite
     * scroll dejaba de cargar. (Bug reportado en Inventario, 2026-07.)
     */
    private _generacion = 0;

    /** Evita que dos `cargarMas` se solapen (doble disparo del ionInfinite). */
    private _cargandoMas = false;

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
        // Nueva generación: invalida cualquier fetchPage (cargar o cargarMas) en vuelo.
        const gen = ++this._generacion;
        this._cargandoMas = false;
        if (!silencioso) this.loading = true;
        this._page = 0;
        try {
            const data = await this.fetchPage(0);
            if (gen !== this._generacion) return;  // llegó tarde: otro cargar/filtro ya tomó el control
            this.items = data;
            this.hasMore = data.length === this.pageSize;
        } catch {
            if (gen !== this._generacion) return;
            // showError silencia el toast cuando es por falta de red (el banner global ya avisa).
            await this.ui.showError('Error al cargar los datos. Verifica tu conexión.');
        } finally {
            if (gen === this._generacion) this.loading = false;
        }
    }

    /** Handler del ion-infinite-scroll: carga la siguiente página y la acumula */
    async cargarMas(event: CustomEvent): Promise<void> {
        const complete = () => (event.target as HTMLIonInfiniteScrollElement).complete();

        // Guard: no acumular sobre un reset en curso ni solapar dos cargarMas.
        if (this._cargandoMas || !this.hasMore) { complete(); return; }
        this._cargandoMas = true;

        const gen = this._generacion;
        const page = this._page + 1;
        try {
            const mas = await this.fetchPage(page);
            // Si un cargar()/filtro corrió mientras esperábamos, este resultado es obsoleto:
            // descartarlo (no tocar items/page/hasMore — ya los maneja el cargar vigente).
            if (gen !== this._generacion) return;
            this._page = page;
            this.items = [...this.items, ...mas];
            this.hasMore = mas.length === this.pageSize;
        } catch {
            if (gen === this._generacion) await this.ui.showToast('Error al cargar más datos', 'danger');
        } finally {
            if (gen === this._generacion) this._cargandoMas = false;
            complete();
        }
    }

    /** Handler del ion-refresher: recarga desde página 0 sin spinner */
    async handleRefresh(event: CustomEvent): Promise<void> {
        await this.cargar(true);
        (event.target as HTMLIonRefresherElement).complete();
    }
}
