import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import {
    IonContent, IonHeader, IonTitle, IonToolbar,
    IonButtons, IonMenuButton, IonIcon,
    IonRefresher, IonRefresherContent,
    IonBadge, IonList, IonItem, IonLabel,
    IonDatetime, IonModal, IonSearchbar,
    IonSkeletonText, IonFooter,
    IonInfiniteScroll, IonInfiniteScrollContent,
    IonFab, IonFabButton,
    ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    calendarOutline, receiptOutline, documentTextOutline,
    documentOutline, cashOutline, cardOutline,
    phonePortraitOutline, handRightOutline,
    cartOutline, chevronDownCircleOutline, banOutline
} from 'ionicons/icons';
import { VentasService } from '../../services/ventas.service';
import { PAGINATION_CONFIG } from '../../../../core/config/pagination.config';
import { Venta } from '../../models/venta.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { getFechaLocal, formatFechaEC, formatHoraEC } from '../../../../core/utils/date.util';
import { VentaDetalleModalComponent } from '../../components/venta-detalle-modal/venta-detalle-modal.component';
import { OptionsMenuComponent, MenuOption } from '../../../../shared/components/options-menu/options-menu.component';
import { PaginatedListPage } from '../../../../shared/pages/paginated-list.page';

@Component({
    selector: 'app-ventas',
    templateUrl: './ventas.page.html',
    styleUrls: ['./ventas.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        IonContent, IonHeader, IonTitle, IonToolbar,
        IonButtons, IonMenuButton, IonIcon,
        IonRefresher, IonRefresherContent,
        IonBadge, IonList, IonItem, IonLabel,
        IonDatetime, IonModal, IonSearchbar,
        IonSkeletonText, IonFooter,
        IonInfiniteScroll, IonInfiniteScrollContent,
        IonFab, IonFabButton,
        OptionsMenuComponent
    ]
})
export class VentasPage extends PaginatedListPage<Venta> implements OnInit, OnDestroy {

    private ventasService = inject(VentasService);
    public currencyService = inject(CurrencyService);
    private modalCtrl = inject(ModalController);
    // ui heredado de PaginatedListPage

    /** Alias para el template — apunta a this.items de la base */
    get ventas(): Venta[] { return this.items; }

    protected readonly pageSize = PAGINATION_CONFIG.ventas.pageSize;
    readonly loadingMoreText = 'Cargando más ventas...';

    /** Filtro de periodo rápido: hoy, semana, mes, todo, custom */
    filtroActivo = 'hoy';

    /** Fecha elegida si filtroActivo === 'custom' */
    fechaFiltro: string = getFechaLocal();

    /** Máximo seleccionable en el picker — getter para que siempre refleje la fecha actual */
    get hoy(): string { return getFechaLocal(); }

    /** Texto de búsqueda actual */
    busqueda = '';
    private search$ = new Subject<string>();
    private searchSub!: Subscription;

    /** Opciones del menú contextual de cada tarjeta */
    readonly ventaMenuOpciones: MenuOption[] = [
        { label: 'Anular venta', icon: 'ban-outline', value: 'anular', color: 'danger' },
    ];

    get fechaLabel(): string {
        const [y, m, d] = this.fechaFiltro.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('es-EC', {
            day: 'numeric', month: 'short', year: 'numeric'
        });
    }

    /** Totales reales desde BD (todos los registros del filtro, no solo la página cargada) */
    totalReal = 0;
    cantidadReal = 0;

    get totalDia(): number { return this.totalReal; }
    get cantidadVentas(): number { return this.cantidadReal; }

    constructor() {
        super();
        addIcons({
            calendarOutline, receiptOutline, documentTextOutline,
            documentOutline, cashOutline, cardOutline,
            phonePortraitOutline, handRightOutline,
            cartOutline, chevronDownCircleOutline, banOutline
        });
    }

    async ngOnInit() {
        this.searchSub = this.search$
            .pipe(debounceTime(500), distinctUntilChanged())
            .subscribe(() => this.cargar());

        await this.cargar();
    }

    ngOnDestroy() {
        this.searchSub?.unsubscribe();
    }

    ionViewWillEnter() {
        this.ui.hideTabs();
    }

    ionViewWillLeave() {
        this.ui.showTabs();
    }

    // ── fetchPage + cargar: implementación requerida por PaginatedListPage ──

    protected async fetchPage(page: number): Promise<Venta[]> {
        const filtro = this.filtroActivo === 'custom' ? this.fechaFiltro : this.filtroActivo;
        return this.ventasService.obtenerVentas(filtro, page, this.busqueda || undefined);
    }

    /** Override: carga lista + totales reales en paralelo */
    protected override async cargar(silencioso = false): Promise<void> {
        const filtro = this.filtroActivo === 'custom' ? this.fechaFiltro : this.filtroActivo;
        const [, resumen] = await Promise.all([
            super.cargar(silencioso),
            this.ventasService.resumirVentas(filtro, this.busqueda || undefined),
        ]);
        this.totalReal     = resumen.total_monto;
        this.cantidadReal  = Number(resumen.total_registros);
    }

    // ── Eventos de filtros ────────────────────────────────────────────────

    onBusquedaChange(event: CustomEvent) {
        this.busqueda = (event.detail?.value ?? '').trim();
        this.search$.next(this.busqueda);
    }

    onFiltroClick(filtro: string) {
        this.filtroActivo = filtro;
        this.cargar();
    }

    onDateChange(event: CustomEvent) {
        const val = event.detail.value as string;
        if (val) {
            this.fechaFiltro = val.split('T')[0];
            this.filtroActivo = 'custom';
            this.cargar();
        }
    }

    // ── Acciones de tarjeta ───────────────────────────────────────────────

    async abrirDetalle(venta: Venta) {
        const modal = await this.modalCtrl.create({
            component: VentaDetalleModalComponent,
            componentProps: { ventaId: venta.id }
        });
        await modal.present();
    }

    async onVentaMenuOption(opcion: MenuOption, _venta: Venta) {
        if (opcion.value === 'anular') {
            await this.ui.showToast('Funcionalidad disponible próximamente', 'warning');
        }
    }

    // ── Helpers template ──────────────────────────────────────────────────

    iconComprobante(tipo: string): string {
        if (tipo === 'FACTURA') return 'document-outline';
        if (tipo === 'NOTA_VENTA') return 'document-text-outline';
        return 'receipt-outline';
    }

    colorComprobante(tipo: string): string {
        if (tipo === 'FACTURA') return 'tertiary';
        if (tipo === 'NOTA_VENTA') return 'secondary';
        return 'primary';
    }

    labelComprobante(tipo: string): string {
        if (tipo === 'FACTURA') return 'Factura';
        if (tipo === 'NOTA_VENTA') return 'Nota Venta';
        return 'Ticket';
    }

    iconMetodoPago(metodo: string): string {
        if (metodo === 'DEUNA') return 'card-outline';
        if (metodo === 'TRANSFERENCIA') return 'phone-portrait-outline';
        if (metodo === 'FIADO') return 'hand-right-outline';
        return 'cash-outline';
    }

    labelMetodoPago(metodo: string): string {
        if (metodo === 'DEUNA') return 'Tarjeta';
        if (metodo === 'TRANSFERENCIA') return 'Transfer.';
        if (metodo === 'FIADO') return 'Fiado';
        return 'Efectivo';
    }

    formatHora(isoString: string): string {
        return formatHoraEC(isoString);
    }

    formatFecha(isoString: string): string {
        return formatFechaEC(isoString);
    }
}
