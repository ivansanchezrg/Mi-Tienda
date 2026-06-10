import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
    IonContent, IonIcon, IonButton,
    IonRefresher, IonRefresherContent,
    AlertController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    cloudUploadOutline, cashOutline, cardOutline, timeOutline,
    alertCircleOutline, syncOutline, trashOutline, refreshOutline
} from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { OutboxService, OutboxVenta } from '@core/services/outbox.service';
import { SyncService } from '@core/services/sync.service';
import { NetworkService } from '@core/services/network.service';
import { UiService } from '@core/services/ui.service';
import { CurrencyService } from '@core/services/currency.service';
import { VentasTabsComponent } from '../../components/ventas-tabs/ventas-tabs.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

/**
 * VentasPendientesPage — cola de ventas offline sin sincronizar (§7 PLAN-OFFLINE-POS).
 *
 * Muestra las ventas guardadas local-first que aún no llegaron al servidor, con su estado
 * (PENDING / ERROR) y botón "Sincronizar ahora". Las ventas ya sincronizadas NO aparecen
 * aquí (viven en Lista/Resumen, que leen del servidor). Mensaje mental para el cajero:
 * Lista/Resumen = lo ya subido; Pendientes = lo que falta subir.
 */
@Component({
    selector: 'app-ventas-pendientes',
    templateUrl: './ventas-pendientes.page.html',
    styleUrls: ['./ventas-pendientes.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
        IonContent, IonIcon, IonButton,
        IonRefresher, IonRefresherContent,
        VentasTabsComponent, EmptyStateComponent
    ]
})
export class VentasPendientesPage implements OnInit, OnDestroy {
    private outbox   = inject(OutboxService);
    private sync     = inject(SyncService);
    private network  = inject(NetworkService);
    private ui       = inject(UiService);
    protected currency = inject(CurrencyService);
    private alertCtrl = inject(AlertController);
    private pendientesSub!: Subscription;

    ventas: OutboxVenta[] = [];
    loading = true;
    sincronizando = false;

    constructor() {
        addIcons({
            cloudUploadOutline, cashOutline, cardOutline, timeOutline,
            alertCircleOutline, syncOutline, trashOutline, refreshOutline
        });
    }

    async ngOnInit() {
        // Refresca la lista ante cualquier cambio en el contador (sync en background, encolado…).
        this.pendientesSub = this.outbox.pendientes$.subscribe(() => this.cargar());
        await this.cargar();
    }

    ngOnDestroy() {
        this.pendientesSub?.unsubscribe();
    }

    async cargar() {
        this.ventas = await this.outbox.obtenerPendientes();
        this.loading = false;
    }

    async handleRefresh(event: CustomEvent) {
        await this.cargar();
        (event.target as HTMLIonRefresherElement).complete();
    }

    /** Dispara el drenado de la cola. */
    async sincronizarAhora() {
        if (this.sincronizando) return;
        if (!this.network.isConnected()) {
            this.ui.showToast('Sin conexión. Conéctate para sincronizar.', 'warning');
            return;
        }
        this.sincronizando = true;
        try {
            await this.sync.sincronizar();
            await this.cargar();
            if (this.ventas.length === 0) {
                this.ui.showToast('Todas las ventas se sincronizaron', 'success');
            }
        } finally {
            this.sincronizando = false;
        }
    }

    /** Reintenta una venta en ERROR: la vuelve a PENDING y dispara el sync. */
    async reintentar(venta: OutboxVenta) {
        await this.outbox.marcarEstado(venta.idempotencyKey, 'PENDING', { error: null });
        await this.sincronizarAhora();
    }

    /** Descarta una venta de la cola (solo para ERROR irrecuperables — confirma primero). */
    async descartar(venta: OutboxVenta) {
        const alert = await this.alertCtrl.create({
            header: 'Descartar venta',
            message: 'Esta venta no se registrará en el servidor. ¿Seguro que quieres descartarla?',
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Descartar',
                    role: 'destructive',
                    handler: async () => {
                        await this.outbox.eliminar(venta.idempotencyKey);
                        await this.cargar();
                    }
                }
            ]
        });
        await alert.present();
    }

    esEfectivo(metodo: string): boolean { return metodo === 'EFECTIVO'; }
}
