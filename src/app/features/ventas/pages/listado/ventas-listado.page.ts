import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import {
    IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
    IonContent, IonIcon,
    IonRefresher, IonRefresherContent,
    IonBadge, IonList, IonItem, IonLabel,
    IonDatetime, IonModal, IonSearchbar,
    IonSkeletonText,
    IonInfiniteScroll, IonInfiniteScrollContent,
    IonFab, IonFabButton,
    ModalController, AlertController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    calendarOutline, receiptOutline, documentTextOutline,
    documentOutline, cashOutline, cardOutline,
    phonePortraitOutline, handRightOutline,
    cartOutline, chevronDownCircleOutline, banOutline,
    arrowUpOutline, closeOutline, searchOutline
} from 'ionicons/icons';
import { VentasService } from '../../services/ventas.service';
import { PAGINATION_CONFIG } from '../../../../core/config/pagination.config';
import { Venta } from '../../models/venta.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { getFechaLocal, formatFechaEC, formatHoraEC } from '../../../../core/utils/date.util';
import { VentaDetalleModalComponent } from '../../components/venta-detalle-modal/venta-detalle-modal.component';
import { OptionsMenuComponent, MenuOption } from '../../../../shared/components/options-menu/options-menu.component';
import { PaginatedListPage } from '../../../../shared/pages/paginated-list.page';
import { VentasTabsComponent } from '../../components/ventas-tabs/ventas-tabs.component';

@Component({
    selector: 'app-ventas-listado',
    templateUrl: './ventas-listado.page.html',
    styleUrls: ['./ventas-listado.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
        IonContent, IonIcon,
        IonRefresher, IonRefresherContent,
        IonBadge, IonList, IonItem, IonLabel,
        IonDatetime, IonModal, IonSearchbar,
        IonSkeletonText,
        IonInfiniteScroll, IonInfiniteScrollContent,
        IonFab, IonFabButton,
        VentasTabsComponent,
        OptionsMenuComponent
    ]
})
export class VentasListadoPage extends PaginatedListPage<Venta> implements OnInit, OnDestroy {

    private ventasService = inject(VentasService);
    public currencyService = inject(CurrencyService);
    private modalCtrl = inject(ModalController);
    private alertCtrl = inject(AlertController);

    get ventas(): Venta[] { return this.items; }

    protected readonly pageSize = PAGINATION_CONFIG.ventas.pageSize;
    readonly loadingMoreText = 'Cargando más ventas...';

    filtroActivo = 'hoy';
    fechaFiltro: string = getFechaLocal();
    get hoy(): string { return getFechaLocal(); }

    busqueda = '';
    private search$ = new Subject<string>();
    private searchSub!: Subscription;

    anulando = false;
    filtroEstado: string | null = null;

    get fechaLabel(): string {
        const [y, m, d] = this.fechaFiltro.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('es-EC', {
            day: 'numeric', month: 'short', year: 'numeric'
        });
    }

    getVentaMenuOpciones(venta: Venta): MenuOption[] {
        if (venta.estado === 'ANULADA') return [];
        return [{ label: 'Anular venta', icon: 'ban-outline', value: 'anular', color: 'danger' }];
    }

    constructor() {
        super();
        addIcons({
            calendarOutline, receiptOutline, documentTextOutline,
            documentOutline, cashOutline, cardOutline,
            phonePortraitOutline, handRightOutline,
            cartOutline, chevronDownCircleOutline, banOutline,
            arrowUpOutline, closeOutline, searchOutline
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

    protected async fetchPage(page: number): Promise<Venta[]> {
        const filtro = this.filtroActivo === 'custom' ? this.fechaFiltro : this.filtroActivo;
        return this.ventasService.obtenerVentas(filtro, page, this.busqueda || undefined, this.filtroEstado || undefined);
    }

    toggleFiltroAnuladas() {
        this.filtroEstado = this.filtroEstado === 'ANULADA' ? null : 'ANULADA';
        this.cargar();
    }

    onBusquedaChange(event: CustomEvent) {
        this.busqueda = (event.detail?.value ?? '').trim();
        this.search$.next(this.busqueda);
    }

    limpiarBusqueda() {
        this.busqueda = '';
        this.cargar();
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

    async abrirDetalle(venta: Venta) {
        const modal = await this.modalCtrl.create({
            component: VentaDetalleModalComponent,
            componentProps: { ventaId: venta.id }
        });
        await modal.present();
    }

    async onVentaMenuOption(opcion: MenuOption, venta: Venta) {
        if (opcion.value === 'anular') await this.confirmarAnulacion(venta);
    }

    private async confirmarAnulacion(venta: Venta) {
        if (this.anulando) return;

        const alert = await this.alertCtrl.create({
            header: `¿Anular venta #${venta.numero_comprobante}?`,
            message: 'Se revertirá el stock y el saldo de caja. Esta acción no se puede deshacer.',
            inputs: [{ name: 'motivo', type: 'textarea', placeholder: 'Motivo de anulación (obligatorio)' }],
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Anular',
                    cssClass: 'alert-button-danger',
                    handler: (data) => {
                        if (!data.motivo?.trim()) {
                            this.ui.showToast('Debes ingresar un motivo', 'warning');
                            return false;
                        }
                        return true;
                    }
                }
            ]
        });
        await alert.present();

        const { data, role } = await alert.onDidDismiss();
        if (role === 'cancel' || !data?.values?.motivo?.trim()) return;

        this.anulando = true;
        try {
            const resultado = await this.ventasService.anularVenta(venta.id, data.values.motivo.trim());
            if (resultado) await this.cargar();
        } finally {
            this.anulando = false;
        }
    }

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

    formatHora(isoString: string): string { return formatHoraEC(isoString); }
    formatFecha(isoString: string): string { return formatFechaEC(isoString); }
}
