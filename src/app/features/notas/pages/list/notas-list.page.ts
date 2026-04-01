import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
    IonContent, IonIcon, IonButton,
    IonRefresher, IonRefresherContent,
    IonList, IonItem, IonLabel, IonItemSliding, IonItemOptions, IonItemOption,
    IonSkeletonText,
    IonInfiniteScroll, IonInfiniteScrollContent,
    IonFab, IonFabButton,
    AlertController, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    readerOutline, addOutline, checkmarkCircleOutline, checkmarkCircle,
    arrowUpOutline, trashOutline, personOutline, ellipseOutline
} from 'ionicons/icons';
import { NotasService } from '../../services/notas.service';
import { AuthService } from '../../../auth/services/auth.service';
import { PAGINATION_CONFIG } from '../../../../core/config/pagination.config';
import { Nota } from '../../models/nota.model';
import { PaginatedListPage } from '../../../../shared/pages/paginated-list.page';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { NuevaNotaModalComponent } from '../../components/nueva-nota-modal/nueva-nota-modal.component';

@Component({
    selector: 'app-notas-list',
    templateUrl: './notas-list.page.html',
    styleUrls: ['./notas-list.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
        IonContent, IonIcon, IonButton,
        IonRefresher, IonRefresherContent,
        IonList, IonItem, IonLabel, IonItemSliding, IonItemOptions, IonItemOption,
        IonSkeletonText,
        IonInfiniteScroll, IonInfiniteScrollContent,
        IonFab, IonFabButton,
        EmptyStateComponent
    ]
})
export class NotasListPage extends PaginatedListPage<Nota> implements OnInit {

    private notasService = inject(NotasService);
    private authService = inject(AuthService);
    private alertCtrl = inject(AlertController);
    private modalCtrl = inject(ModalController);

    get notas(): Nota[] { return this.items; }

    protected readonly pageSize = PAGINATION_CONFIG.notas.pageSize;
    readonly loadingMoreText = 'Cargando más notas...';

    private usuarioId: number | null = null;
    creando = false;

    constructor() {
        super();
        addIcons({
            readerOutline, addOutline, checkmarkCircleOutline, checkmarkCircle,
            arrowUpOutline, trashOutline, personOutline, ellipseOutline
        });
    }

    async ngOnInit() {
        const usuario = await this.authService.getUsuarioActual();
        this.usuarioId = usuario?.id ?? null;
        await this.cargar();
    }

    protected async fetchPage(page: number): Promise<Nota[]> {
        return this.notasService.listar(page);
    }

    async nuevaNota() {
        const modal = await this.modalCtrl.create({
            component: NuevaNotaModalComponent,
            cssClass: 'bottom-sheet-modal',
            breakpoints: [0, 1],
            initialBreakpoint: 1,
        });
        await modal.present();
        const { data, role } = await modal.onDidDismiss<{ texto: string }>();
        if (role === 'confirm' && data?.texto) {
            await this.guardarNota(data.texto);
        }
    }

    private async guardarNota(texto: string) {
        if (!this.usuarioId || this.creando) return;
        this.creando = true;
        try {
            const nueva = await this.notasService.crear(texto, this.usuarioId);
            if (nueva) {
                this.items = [nueva, ...this.items];
            }
        } finally {
            this.creando = false;
        }
    }

    async toggleCompletada(nota: Nota) {
        if (!this.usuarioId) return;
        if (nota.completada) {
            const actualizada = await this.notasService.reactivar(nota.id);
            if (actualizada) this.reemplazarNota(actualizada);
        } else {
            const actualizada = await this.notasService.marcarCompletada(nota.id, this.usuarioId);
            if (actualizada) this.reemplazarNota(actualizada);
        }
    }

    async eliminar(nota: Nota, slidingItem: IonItemSliding) {
        await slidingItem.close();
        const alert = await this.alertCtrl.create({
            header: 'Eliminar nota',
            message: '¿Seguro que quieres eliminar esta nota?',
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Eliminar',
                    role: 'destructive',
                    handler: async () => {
                        const ok = await this.notasService.eliminar(nota.id);
                        if (ok) {
                            this.items = this.items.filter(n => n.id !== nota.id);
                        }
                    }
                }
            ]
        });
        await alert.present();
    }

    private reemplazarNota(actualizada: Nota) {
        const idx = this.items.findIndex(n => n.id === actualizada.id);
        if (idx < 0) return;
        this.items[idx] = actualizada;
        this.items = [
            ...this.items.filter(n => !n.completada),
            ...this.items.filter(n => n.completada)
        ];
    }

    formatFecha(fecha: string): string {
        const d = new Date(fecha);
        const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
        if (diffMin < 1) return 'Ahora';
        if (diffMin < 60) return `Hace ${diffMin} min`;
        const diffH = Math.floor(diffMin / 60);
        if (diffH < 24) return `Hace ${diffH}h`;
        const diffD = Math.floor(diffH / 24);
        if (diffD === 1) return 'Ayer';
        if (diffD < 7) return `Hace ${diffD} días`;
        return d.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' });
    }
}
