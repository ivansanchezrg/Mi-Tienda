import { inject } from '@angular/core';
import { UiService } from '../../core/services/ui.service';

/**
 * Clase base para páginas con listado paginado + infinite scroll.
 *
 * Uso:
 *   1. Extender esta clase en la página.
 *   2. Implementar `pageSize` y `fetchPage(page)`.
 *   3. En el template, usar `items` (o un getter alias) + los métodos heredados.
 *   4. Llamar `this.cargar()` para cargar/recargar desde página 0.
 *
 * La subclase NO necesita declarar: loading, hasMore, cargarMas, handleRefresh.
 *
 * Ejemplo:
 * ```typescript
 * export class MiListaPage extends PaginatedListPage<MiItem> {
 *     protected readonly pageSize = 20;
 *     get items_alias() { return this.items; }   // opcional: alias para el template
 *
 *     protected async fetchPage(page: number): Promise<MiItem[]> {
 *         return this.miServicio.listar(page, this.pageSize);
 *     }
 * }
 * ```
 */
export abstract class PaginatedListPage<T> {

    protected ui = inject(UiService);

    /** Items cargados acumulados (todas las páginas) */
    items: T[] = [];

    /** Muestra skeleton en la primera carga */
    loading = false;

    /** Controla si el infinite scroll sigue activo */
    hasMore = false;

    private _page = 0;

    /** Registros por página — debe definirlo cada subclase */
    protected abstract readonly pageSize: number;

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
            await this.ui.showToast('Error al cargar los datos', 'danger');
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
}
