import { Component, Input, OnInit, inject, computed, signal, Signal, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonSpinner, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, chevronForwardOutline, imageOutline, arrowForwardOutline } from 'ionicons/icons';
import { ProductoPOS, ProductoPresentacion } from '../../../inventario/models/producto.model';
import { CartItem } from '../../models/cart-item.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { volarCloneHacia } from '../../utils/fly-clone.util';

export interface VarianteSelectorResult {
    varianteId: string;
    presentacionId?: string;
}

@Component({
    selector: 'app-variante-selector-modal',
    templateUrl: './variante-selector-modal.component.html',
    styleUrls: ['./variante-selector-modal.component.scss'],
    standalone: true,
    imports: [CommonModule, IonIcon, IonSpinner]
})
export class VarianteSelectorModalComponent implements OnInit {
    @Input() templateNombre!: string;
    @Input() subtitle!: string;
    @Input() variantes!: ProductoPOS[];
    @Input() onAgregar!: (result: VarianteSelectorResult) => Promise<boolean>;
    @Input() onIncrementar!: (result: VarianteSelectorResult) => Promise<boolean>;
    @Input() onDecrementar!: (result: VarianteSelectorResult) => Promise<void>;
    /** Retorna la nueva cantidad tras edición, o null si el usuario canceló. */
    @Input() onEditarCantidad!: (result: VarianteSelectorResult) => Promise<number | null>;
    /** Carrito actual del POS — usado para pre-poblar contadores al reabrir el modal. */
    @Input() carritoActual: CartItem[] = [];
    /** Signal del total a pagar del carrito completo (incluye ítems fuera de este modal). */
    @Input() totalCarrito!: Signal<number>;
    /** Signal del total de artículos del carrito completo. */
    @Input() totalArticulosCarrito!: Signal<number>;

    @ViewChild('continuarBtn') private continuarBtnRef!: ElementRef<HTMLButtonElement>;

    protected currencyService = inject(CurrencyService);
    private modalCtrl = inject(ModalController);

    protected procesando = false;
    protected footerAnimando = false;
    // Key del ítem cuyo modal de cantidad está cargando (consulta stock fresco)
    protected editandoKey: string | null = null;

    protected readonly _contadores = signal<Map<string, number>>(new Map());

    /** Cantidad total de ítems en carrito relacionados con este modal. */
    protected readonly totalAgregado = computed(() => {
        let total = 0;
        this._contadores().forEach(v => total += v);
        return total;
    });

    constructor() {
        addIcons({ closeOutline, chevronForwardOutline, imageOutline, arrowForwardOutline });
    }

    ngOnInit() {
        this.sincronizarDesdeCarrito();
    }

    /** Pre-pobla contadores desde el carrito actual al abrir el modal. */
    private sincronizarDesdeCarrito() {
        const varianteIds = new Set(this.variantes.map(v => v.id));
        const contadores = new Map<string, number>();

        for (const item of this.carritoActual) {
            if (!varianteIds.has(item.id)) continue;
            const key = item.presentacion_id
                ? `${item.id}::${item.presentacion_id}`
                : item.id;
            contadores.set(key, (contadores.get(key) ?? 0) + item.cantidad);
        }

        this._contadores.set(contadores);
    }

    get prefijo(): string {
        return this.templateNombre.trim() + ' ';
    }

    labelVariante(v: ProductoPOS): string {
        return v.nombre.startsWith(this.prefijo) ? v.nombre.slice(this.prefijo.length) : v.nombre;
    }

    tienePresentaciones(v: ProductoPOS): boolean {
        return (v.presentaciones?.length ?? 0) > 0;
    }

    countVariante(v: ProductoPOS): number {
        const map = this._contadores();
        let total = map.get(v.id) ?? 0;
        for (const p of v.presentaciones ?? []) {
            total += map.get(`${v.id}::${p.id}`) ?? 0;
        }
        return total;
    }

    countPresentacion(v: ProductoPOS, p: ProductoPresentacion): number {
        return this._contadores().get(`${v.id}::${p.id}`) ?? 0;
    }

    /**
     * Devuelve true si el stock del SKU está agotado para la combinación dada.
     * Para una presentación: compara unidades comprometidas (todas las presentaciones + unidad suelta)
     * vs stock_actual usando el factor de conversión.
     * Para unidad suelta o variante sin presentaciones: compara directamente.
     */
    sinStock(v: ProductoPOS, p?: ProductoPresentacion): boolean {
        return this.stockLibre(v, p) <= 0;
    }

    /** Unidades libres disponibles para agregar de esta variante/presentación. */
    stockLibre(v: ProductoPOS, p?: ProductoPresentacion): number {
        const stock = v.stock_actual;
        if (stock <= 0) return 0;
        const map = this._contadores();
        let unidadesComprometidas = map.get(v.id) ?? 0;
        for (const pres of v.presentaciones ?? []) {
            unidadesComprometidas += (map.get(`${v.id}::${pres.id}`) ?? 0) * pres.factor_conversion;
        }
        const factor = p?.factor_conversion ?? 1;
        return Math.floor((stock - unidadesComprometidas) / factor);
    }

    async seleccionarVariante(v: ProductoPOS, event: Event) {
        if (this.procesando) return;
        if (this.tienePresentaciones(v)) return;
        const rowEl = (event.currentTarget as HTMLElement).closest('.vsm-row') as HTMLElement;
        await this.agregar(v.id, undefined, rowEl);
    }

    async seleccionarUnidadSuelta(v: ProductoPOS, event: Event) {
        if (this.procesando) return;
        const rowEl = (event.currentTarget as HTMLElement).closest('.vsm-row') as HTMLElement;
        await this.agregar(v.id, undefined, rowEl);
    }

    async seleccionarPresentacion(v: ProductoPOS, p: ProductoPresentacion, event: Event) {
        if (this.procesando) return;
        const rowEl = (event.currentTarget as HTMLElement).closest('.vsm-row') as HTMLElement;
        await this.agregar(v.id, p.id, rowEl);
    }

    private async agregar(varianteId: string, presentacionId: string | undefined, rowEl: HTMLElement | null) {
        this.procesando = true;
        const key = presentacionId ? `${varianteId}::${presentacionId}` : varianteId;
        // Capturar thumb y btn ANTES del await — el DOM puede cambiar tras la operación
        const thumbEl = rowEl?.querySelector<HTMLElement>('.vsm-row-thumb') ?? null;
        const thumbClone = thumbEl?.cloneNode(true) as HTMLElement | null ?? null;
        const thumbRect = thumbEl?.getBoundingClientRect() ?? null;
        try {
            const agregado = await this.onAgregar({ varianteId, presentacionId });
            if (!agregado) return; // sin stock — el POS ya mostró el toast
            this._contadores.update(m => {
                const next = new Map(m);
                next.set(key, (next.get(key) ?? 0) + 1);
                return next;
            });
            // Bump inmediato en el botón — feedback instantáneo al usuario
            this.footerAnimando = true;
            setTimeout(() => { this.footerAnimando = false; }, 400);
            // Vuelo del thumbnail — decorativo, arranca en paralelo
            if (thumbClone && thumbRect) setTimeout(() => this.flyThumbToFooter(thumbClone, thumbRect), 0);
        } finally {
            this.procesando = false;
        }
    }

    private flyThumbToFooter(thumbClone: HTMLElement, thumbRect: DOMRect) {
        const btnEl = this.continuarBtnRef?.nativeElement;
        if (!btnEl) return;

        volarCloneHacia(thumbClone, thumbRect, btnEl, {
            tamanoFinal: 28,
            borderRadius: '6px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        });
    }

    async incrementarItem(v: ProductoPOS, p?: ProductoPresentacion) {
        if (this.procesando) return;
        this.procesando = true;
        try {
            const incrementado = await this.onIncrementar({ varianteId: v.id, presentacionId: p?.id });
            if (!incrementado) return; // stock agotado — el POS ya mostró el toast
            const key = p ? `${v.id}::${p.id}` : v.id;
            this._contadores.update(m => {
                const next = new Map(m);
                next.set(key, (next.get(key) ?? 0) + 1);
                return next;
            });
        } finally {
            this.procesando = false;
        }
    }

    async decrementarItem(v: ProductoPOS, p?: ProductoPresentacion) {
        if (this.procesando) return;
        this.procesando = true;
        try {
            await this.onDecrementar({ varianteId: v.id, presentacionId: p?.id });
            const key = p ? `${v.id}::${p.id}` : v.id;
            this._contadores.update(m => {
                const next = new Map(m);
                const current = next.get(key) ?? 0;
                if (current <= 1) next.delete(key);
                else next.set(key, current - 1);
                return next;
            });
        } finally {
            this.procesando = false;
        }
    }

    async editarCantidadItem(v: ProductoPOS, p?: ProductoPresentacion) {
        const key = p ? `${v.id}::${p.id}` : v.id;
        if (this.editandoKey === key) return;
        this.editandoKey = key;
        try {
            const nuevaCantidad = await this.onEditarCantidad({ varianteId: v.id, presentacionId: p?.id });
            if (nuevaCantidad === null) return;
            this._contadores.update(m => {
                const next = new Map(m);
                if (nuevaCantidad <= 0) next.delete(key);
                else next.set(key, nuevaCantidad);
                return next;
            });
        } finally {
            this.editandoKey = null;
        }
    }

    continuar() {
        this.modalCtrl.dismiss(null, 'continuar');
    }

    cerrar() {
        this.modalCtrl.dismiss(null, 'cancel');
    }
}
