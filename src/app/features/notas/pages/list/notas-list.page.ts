import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import {
    IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
    IonContent, IonIcon, IonButton,
    IonRefresher, IonRefresherContent,
    IonList, IonItem, IonLabel, IonItemSliding, IonItemOptions, IonItemOption,
    IonSkeletonText, IonSpinner,
    IonInfiniteScroll, IonInfiniteScrollContent,
    IonFab, IonFabButton,
    ModalController
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
        IonSkeletonText, IonSpinner,
        IonInfiniteScroll, IonInfiniteScrollContent,
        IonFab, IonFabButton,
        EmptyStateComponent
    ]
})
export class NotasListPage extends PaginatedListPage<Nota> implements OnInit, OnDestroy {

    private notasService = inject(NotasService);
    private authService = inject(AuthService);
    private modalCtrl = inject(ModalController);

    get notas(): Nota[] { return this.items; }

    protected readonly pageSize = PAGINATION_CONFIG.notas.pageSize;
    readonly loadingMoreText = 'Cargando más notas...';

    private usuarioId: string | null = null;
    esAdmin = false;
    creando = false;
    procesando = new Set<string>();  // ids de notas con operación en curso
    private notaCreadaSub!: Subscription;
    expandidas = new Set<string>(); // ids de notas con texto expandido

    esLarga(nota: Nota): boolean {
        const lineas = nota.texto.split('\n');
        return lineas.length > 1 || nota.texto.length > 120;
    }

    lineasVisibles(nota: Nota): { prefijo: string; cuerpo: string }[] {
        const todasLasLineas = nota.texto.split('\n');
        const lineas = this.expandidas.has(nota.id)
            ? todasLasLineas
            : [todasLasLineas[0].length > 120
                ? todasLasLineas[0].substring(0, 120) + '…'
                : todasLasLineas[0]];

        const listPattern = /^(\d+[.)]\s|[-*•]\s)/;
        return lineas.map(l => {
            const m = l.match(listPattern);
            return m
                ? { prefijo: m[0].replace(/\s+$/, ''), cuerpo: l.slice(m[0].length) }
                : { prefijo: '', cuerpo: l };
        });
    }

    toggleExpandir(event: Event, nota: Nota) {
        event.stopPropagation();
        if (this.expandidas.has(nota.id)) {
            this.expandidas.delete(nota.id);
        } else {
            this.expandidas.add(nota.id);
        }
    }

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
        this.esAdmin = usuario?.rol === 'ADMIN';
        await this.cargar();

        // Escuchar notas creadas desde el FAB global
        this.notaCreadaSub = this.notasService.notaCreada$.subscribe(nueva => {
            this.items = [nueva, ...this.items];
        });
    }

    ngOnDestroy() {
        this.notaCreadaSub?.unsubscribe();
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
            await this.notasService.crear(texto, this.usuarioId);
            // El Subject notaCreada$ se encarga de agregar a la lista
        } finally {
            this.creando = false;
        }
    }

    async toggleCompletada(nota: Nota) {
        if (!this.usuarioId || this.procesando.has(nota.id)) return;

        // Optimistic update inmediato
        const original = { ...nota };
        this.procesando.add(nota.id);
        nota.completada = !nota.completada;

        try {
            const actualizada = nota.completada
                ? await this.notasService.marcarCompletada(nota.id, this.usuarioId)
                : await this.notasService.reactivar(nota.id);

            if (actualizada) {
                this.reemplazarNota(actualizada);
            } else {
                // Rollback si falló
                this.reemplazarNota(original);
            }
        } catch {
            this.reemplazarNota(original);
        } finally {
            this.procesando.delete(nota.id);
        }
    }

    async eliminar(nota: Nota, slidingItem: IonItemSliding) {
        await slidingItem.close();
        this.notasService.eliminar(nota.id);
        this.items = this.items.filter(n => n.id !== nota.id);
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
