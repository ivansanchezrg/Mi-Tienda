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
    ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    personOutline, callOutline, mailOutline,
    cardOutline, arrowUpOutline, createOutline,
    searchOutline, closeOutline, personAddOutline
} from 'ionicons/icons';
import { ClientesService } from '../../services/clientes.service';
import { PAGINATION_CONFIG } from '../../../../core/config/pagination.config';
import { Cliente } from '../../models/cliente.model';
import { PaginatedListPage } from '../../../../shared/pages/paginated-list.page';
import { EditarClienteModalComponent } from '../../components/editar-cliente-modal/editar-cliente-modal.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';

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
export class ClientesListadoPage extends PaginatedListPage<Cliente> implements OnInit, OnDestroy {

    private clientesService = inject(ClientesService);
    private modalCtrl = inject(ModalController);

    get clientes(): Cliente[] { return this.items; }

    protected readonly pageSize = PAGINATION_CONFIG.clientes.pageSize;
    readonly loadingMoreText = 'Cargando más clientes...';

    busqueda = '';
    private search$ = new Subject<string>();
    private searchSub!: Subscription;

    constructor() {
        super();
        addIcons({
            personOutline, callOutline, mailOutline,
            cardOutline, arrowUpOutline, createOutline,
            searchOutline, closeOutline, personAddOutline
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

    protected async fetchPage(page: number): Promise<Cliente[]> {
        return this.clientesService.listarClientes(page, this.busqueda || undefined);
    }

    onBusquedaChange(event: CustomEvent) {
        this.busqueda = (event.detail?.value ?? '').trim();
        this.search$.next(this.busqueda);
    }

    limpiarBusqueda() {
        this.busqueda = '';
        this.cargar();
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

    async editarCliente(cliente: Cliente) {
        const modal = await this.modalCtrl.create({
            component: EditarClienteModalComponent,
            componentProps: { cliente }
        });
        await modal.present();
        const { data } = await modal.onDidDismiss();
        if (data?.cliente) {
            const idx = this.items.findIndex(c => c.id === data.cliente.id);
            if (idx >= 0) {
                this.items[idx] = data.cliente;
                this.items = [...this.items];
            }
        }
    }
}
