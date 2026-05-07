import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import {
    IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
    IonContent, IonIcon,
    IonRefresher, IonRefresherContent,
    IonList, IonItem, IonLabel,
    IonSearchbar, IonSkeletonText,
    IonInfiniteScroll, IonInfiniteScrollContent,
    IonFab, IonFabButton, IonButton,
    ModalController, NavController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    personOutline, callOutline, cardOutline,
    arrowUpOutline, personAddOutline, chevronForwardOutline
} from 'ionicons/icons';
import { CuentasCobrarService } from '../../services/cuentas-cobrar.service';
import { AuthService } from '../../../auth/services/auth.service';
import { ClienteConSaldo } from '../../models/cuenta-cobrar.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { PAGINATION_CONFIG } from '../../../../core/config/pagination.config';
import { PaginatedListPage } from '../../../../shared/pages/paginated-list.page';
import { EditarClienteModalComponent } from '../../components/editar-cliente-modal/editar-cliente-modal.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { ROUTES } from '../../../../core/config/routes.config';
import { formatFechaEC } from '../../../../core/utils/date.util';

@Component({
    selector: 'app-clientes-listado',
    templateUrl: './clientes-listado.page.html',
    styleUrls: ['./clientes-listado.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
        IonContent, IonIcon,
        IonRefresher, IonRefresherContent,
        IonList, IonItem, IonLabel,
        IonSearchbar, IonSkeletonText,
        IonInfiniteScroll, IonInfiniteScrollContent,
        IonFab, IonFabButton, IonButton,
        EmptyStateComponent
    ]
})
export class ClientesListadoPage extends PaginatedListPage<ClienteConSaldo> implements OnInit, OnDestroy {

    private cuentasService = inject(CuentasCobrarService);
    private authService = inject(AuthService);
    public currencyService = inject(CurrencyService);
    private modalCtrl = inject(ModalController);
    private navCtrl = inject(NavController);

    esSuperadmin = false;

    get clientes(): ClienteConSaldo[] { return this.items; }

    protected readonly pageSize = PAGINATION_CONFIG.clientes.pageSize;
    readonly loadingMoreText = 'Cargando más clientes...';

    busqueda = '';
    private search$ = new Subject<string>();
    private searchSub!: Subscription;

    constructor() {
        super();
        addIcons({
            personOutline, callOutline, cardOutline,
            arrowUpOutline, personAddOutline, chevronForwardOutline
        });
    }

    async ngOnInit() {
        const usuario = await this.authService.getUsuarioActual();
        this.esSuperadmin = usuario?.es_superadmin ?? false;

        this.searchSub = this.search$
            .pipe(debounceTime(500), distinctUntilChanged())
            .subscribe(() => this.cargar());
        await this.cargar();
    }

    ngOnDestroy() {
        this.searchSub?.unsubscribe();
    }

    protected async fetchPage(page: number): Promise<ClienteConSaldo[]> {
        return this.cuentasService.listarClientesConSaldo(page, this.busqueda || undefined);
    }

    onBusquedaChange(event: CustomEvent) {
        this.busqueda = (event.detail?.value ?? '').trim();
        this.search$.next(this.busqueda);
    }

    verCliente(cliente: ClienteConSaldo) {
        this.navCtrl.navigateForward(ROUTES.clientes.detalle(cliente.cliente_id));
    }

    async abrirNuevoCliente() {
        const modal = await this.modalCtrl.create({
            component: EditarClienteModalComponent,
            componentProps: { cliente: null }
        });
        await modal.present();
        const { data } = await modal.onDidDismiss();
        if (data?.cliente) {
            await this.cargar();
        }
    }

    iniciales(nombre: string): string {
        if (!nombre?.trim()) return '?';
        return nombre.trim().split(' ').slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');
    }

    formatFecha(iso: string): string {
        return formatFechaEC(iso);
    }
}
