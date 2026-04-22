import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import {
    IonContent, IonHeader, IonTitle, IonToolbar,
    IonButtons, IonMenuButton, IonIcon,
    IonRefresher, IonRefresherContent,
    IonList, IonItem, IonLabel, IonSearchbar,
    IonSkeletonText, IonFooter, IonAvatar,
    IonInfiniteScroll, IonInfiniteScrollContent,
    IonFab, IonFabButton,
    ViewWillEnter, ViewWillLeave
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    handRightOutline, searchOutline, personOutline,
    chevronForwardOutline, chevronDownCircleOutline,
    arrowUpOutline, callOutline
} from 'ionicons/icons';
import { CuentasCobrarService } from '../../services/cuentas-cobrar.service';
import { CuentaCliente } from '../../models/cuenta-cobrar.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { PAGINATION_CONFIG } from '../../../../core/config/pagination.config';
import { PaginatedListPage } from '../../../../shared/pages/paginated-list.page';
import { formatFechaEC } from '../../../../core/utils/date.util';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { ROUTES } from '../../../../core/config/routes.config';

@Component({
    selector: 'app-cuentas-cobrar',
    templateUrl: './cuentas-cobrar.page.html',
    styleUrls: ['./cuentas-cobrar.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        IonContent, IonHeader, IonTitle, IonToolbar,
        IonButtons, IonMenuButton, IonIcon,
        IonRefresher, IonRefresherContent,
        IonList, IonItem, IonLabel, IonSearchbar,
        IonSkeletonText, IonFooter,
        IonInfiniteScroll, IonInfiniteScrollContent,
        IonFab, IonFabButton,
        EmptyStateComponent
    ]
})
export class CuentasCobrarPage extends PaginatedListPage<CuentaCliente> implements OnInit, OnDestroy, ViewWillEnter, ViewWillLeave {

    private cuentasService = inject(CuentasCobrarService);
    public currencyService = inject(CurrencyService);
    private router = inject(Router);

    get cuentas(): CuentaCliente[] { return this.items; }

    protected readonly pageSize = PAGINATION_CONFIG.cuentasCobrar.pageSize;
    readonly loadingMoreText = 'Cargando más clientes...';

    busqueda = '';
    private search$ = new Subject<string>();
    private searchSub!: Subscription;

    totalDeuda = 0;
    totalClientes = 0;

    constructor() {
        super();
        addIcons({
            handRightOutline, searchOutline, personOutline,
            chevronForwardOutline, chevronDownCircleOutline,
            arrowUpOutline, callOutline
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
        this.cargar(true);
    }

    ionViewWillLeave() {
        this.ui.showTabs();
    }

    // ── PaginatedListPage implementation ──

    protected async fetchPage(page: number): Promise<CuentaCliente[]> {
        return this.cuentasService.listarClientesConDeuda(page, this.busqueda || undefined);
    }

    protected override async cargar(silencioso = false): Promise<void> {
        const [, resumen] = await Promise.all([
            super.cargar(silencioso),
            this.cuentasService.obtenerResumen(this.busqueda || undefined),
        ]);
        this.totalDeuda = resumen.total_deuda;
        this.totalClientes = resumen.total_clientes;
    }

    // ── Eventos ──

    onBusquedaChange(event: CustomEvent) {
        this.busqueda = (event.detail?.value ?? '').trim();
        this.search$.next(this.busqueda);
    }

    abrirDetalle(cuenta: CuentaCliente) {
        this.router.navigate([ROUTES.cuentasCobrar.detalle(String(cuenta.cliente_id))]);
    }

    // ── Helpers template ──

    formatFecha(iso: string): string {
        return formatFechaEC(iso);
    }

    /** Iniciales del nombre para el avatar */
    iniciales(nombre: string): string {
        if (!nombre?.trim()) return '?';
        return nombre
            .split(' ')
            .slice(0, 2)
            .map(p => p.charAt(0).toUpperCase())
            .join('');
    }
}
