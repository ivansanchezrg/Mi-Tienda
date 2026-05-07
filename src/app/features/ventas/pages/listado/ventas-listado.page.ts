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
    arrowUpOutline, closeOutline, searchOutline,
    peopleOutline, chevronDownOutline, shareOutline
} from 'ionicons/icons';
import { VentasService } from '../../services/ventas.service';
import { ShareVentaService } from '../../services/share-venta.service';
import { AuthService } from '../../../auth/services/auth.service';
import { TurnosCajaService } from '../../../caja/services/turnos-caja.service';
import { RolUsuario } from '../../../auth/models/usuario_actual.model';
import { TurnoCajaConEmpleado } from '../../../caja/models/turno-caja.model';
import { PAGINATION_CONFIG } from '../../../../core/config/pagination.config';
import { Venta } from '../../models/venta.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { getFechaLocal, formatFechaEC, formatHoraEC } from '../../../../core/utils/date.util';
import { VentaDetalleModalComponent } from '../../components/venta-detalle-modal/venta-detalle-modal.component';
import { OptionsMenuComponent, MenuOption } from '../../../../shared/components/options-menu/options-menu.component';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';
import { PaginatedListPage } from '../../../../shared/pages/paginated-list.page';
import { VentasTabsComponent } from '../../components/ventas-tabs/ventas-tabs.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';

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
        OptionsMenuComponent,
        EmptyStateComponent
    ]
})
export class VentasListadoPage extends PaginatedListPage<Venta> implements OnInit, OnDestroy {

    private ventasService = inject(VentasService);
    private shareService  = inject(ShareVentaService);
    private authService = inject(AuthService);
    private turnosCajaService = inject(TurnosCajaService);
    protected currencyService = inject(CurrencyService);
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
    compartiendo = false;
    filtroEstado: string | null = null;

    // Rol y usuario actual
    rolUsuario: RolUsuario | null = null;
    usuarioId: string | null = null;
    esSuperadmin = false;

    // Filtro por turno (solo ADMIN)
    turnosDelDia: TurnoCajaConEmpleado[] = [];
    turnoSeleccionado: TurnoCajaConEmpleado | null = null;

    get mostrarFiltroTurno(): boolean {
        return this.rolUsuario === 'ADMIN'
            && this.turnosDelDia.length > 1
            && (this.filtroActivo === 'hoy' || this.filtroActivo === 'custom');
    }

    get labelTurno(): string {
        if (!this.turnoSeleccionado) return 'Todos los turnos';
        const t = this.turnoSeleccionado;
        const hora = this.formatHoraTurno(t.hora_fecha_apertura);
        const cierre = t.hora_fecha_cierre ? this.formatHoraTurno(t.hora_fecha_cierre) : 'en curso';
        return `Turno ${t.numero_turno} (${hora} - ${cierre}) — ${t.empleado?.nombre ?? ''}`;
    }

    get fechaLabel(): string {
        const [y, m, d] = this.fechaFiltro.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('es-EC', {
            day: 'numeric', month: 'short', year: 'numeric'
        });
    }

    getVentaMenuOpciones(venta: Venta): MenuOption[] {
        if (venta.estado === 'ANULADA') return [];
        const opciones: MenuOption[] = [
            { label: 'Compartir comprobante', icon: 'share-outline', value: 'compartir' },
        ];
        // EMPLEADO solo puede anular sus propias ventas
        const puedeAnular = this.rolUsuario === 'ADMIN' || venta.empleado_id === this.usuarioId;
        if (puedeAnular) {
            opciones.push({ label: 'Anular venta', icon: 'ban-outline', value: 'anular', color: 'danger' });
        }
        return opciones;
    }

    constructor() {
        super();
        addIcons({
            calendarOutline, receiptOutline, documentTextOutline,
            documentOutline, cashOutline, cardOutline,
            phonePortraitOutline, handRightOutline,
            cartOutline, chevronDownCircleOutline, banOutline,
            arrowUpOutline, closeOutline, searchOutline,
            peopleOutline, chevronDownOutline, shareOutline
        });
    }

    async ngOnInit() {
        this.searchSub = this.search$
            .pipe(debounceTime(500), distinctUntilChanged())
            .subscribe(() => this.cargar());
        const usuario = await this.authService.getUsuarioActual();
        this.rolUsuario = usuario?.rol ?? null;
        this.usuarioId = usuario?.id ?? null;
        this.esSuperadmin = usuario?.es_superadmin ?? false;
        await Promise.all([
            this.cargar(),
            this.cargarTurnos()
        ]);
    }

    ngOnDestroy() {
        this.searchSub?.unsubscribe();
    }

    protected async fetchPage(page: number): Promise<Venta[]> {
        const filtro = this.filtroActivo === 'custom' ? this.fechaFiltro : this.filtroActivo;
        return this.ventasService.obtenerVentas(
            filtro, page,
            this.busqueda || undefined,
            this.filtroEstado || undefined,
            this.turnoSeleccionado?.id
        );
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

    fechaPickerVisible = true;

    onFiltroClick(filtro: string) {
        this.filtroActivo = filtro;
        this.turnoSeleccionado = null;
        // Resetear el IonDatetime a hoy destruyéndolo y recreándolo
        this.fechaFiltro = getFechaLocal();
        this.fechaPickerVisible = false;
        setTimeout(() => { this.fechaPickerVisible = true; }, 0);
        if (filtro === 'hoy') {
            this.cargarTurnos();
        } else if (filtro !== 'custom') {
            this.turnosDelDia = [];
        }
        this.cargar();
    }

    onDateChange(event: CustomEvent) {
        const val = event.detail.value as string;
        if (val) {
            this.fechaFiltro = val.split('T')[0];
            this.filtroActivo = 'custom';
            this.turnoSeleccionado = null;
            this.cargarTurnos(this.fechaFiltro);
            this.cargar();
        }
    }

    private async cargarTurnos(fecha?: string) {
        this.turnosDelDia = await this.turnosCajaService.obtenerTurnosDeFecha(fecha);
    }

    async abrirSelectorTurno() {
        const groups: ModalOptionGroup[] = [{
            options: [
                { label: 'Todos los turnos', value: 'todos' },
                ...this.turnosDelDia.map(t => {
                    const hora = this.formatHoraTurno(t.hora_fecha_apertura);
                    const cierre = t.hora_fecha_cierre ? this.formatHoraTurno(t.hora_fecha_cierre) : 'en curso';
                    return {
                        label: `Turno ${t.numero_turno} — ${t.empleado?.nombre ?? ''}`,
                        subtitle: `${hora} - ${cierre}`,
                        value: t.id
                    };
                })
            ]
        }];

        const modal = await this.modalCtrl.create({
            component: OptionsModalComponent,
            componentProps: {
                title: 'Filtrar por turno',
                groups,
                selectedValue: this.turnoSeleccionado?.id ?? 'todos'
            },
            cssClass: 'options-modal',
            breakpoints: [0, 1],
            initialBreakpoint: 1
        });
        await modal.present();

        const { data } = await modal.onDidDismiss();
        if (data !== undefined) {
            this.turnoSeleccionado = data === 'todos'
                ? null
                : this.turnosDelDia.find(t => t.id === data) ?? null;
            this.cargar();
        }
    }

    formatHoraTurno(iso: string): string {
        return new Date(iso).toLocaleTimeString('es-EC', {
            hour: '2-digit', minute: '2-digit', hour12: true
        });
    }

    async abrirDetalle(venta: Venta) {
        const modal = await this.modalCtrl.create({
            component: VentaDetalleModalComponent,
            componentProps: { ventaId: venta.id }
        });
        await modal.present();
    }

    async onVentaMenuOption(opcion: MenuOption, venta: Venta) {
        if (opcion.value === 'anular')    await this.confirmarAnulacion(venta);
        if (opcion.value === 'compartir') await this.compartirVenta(venta);
    }

    private async compartirVenta(venta: Venta) {
        if (this.compartiendo) return;
        this.compartiendo = true;
        await this.ui.showLoading('Generando comprobante...');
        try {
            const ventaDetalle = await this.ventasService.obtenerVentaDetalle(venta.id);
            if (!ventaDetalle) {
                this.ui.showToast('No se pudo cargar el detalle', 'danger');
                return;
            }
            await this.shareService.compartirVenta(ventaDetalle);
        } catch (err: any) {
            const msg = (err?.message ?? '').toLowerCase();
            if (msg.includes('cancel') || msg.includes('dismiss') || msg.includes('abort')) return;
            this.ui.showToast('No se pudo generar el comprobante', 'danger');
        } finally {
            await this.ui.hideLoading();
            this.compartiendo = false;
        }
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
