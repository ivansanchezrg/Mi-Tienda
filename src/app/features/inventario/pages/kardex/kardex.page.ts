import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { NavController, ModalController } from '@ionic/angular/standalone';
import {
    IonHeader, IonToolbar, IonButtons, IonButton, IonTitle,
    IonContent, IonRefresher, IonRefresherContent,
    IonCard, IonCardContent, IonIcon, IonSpinner
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    arrowBackOutline, timeOutline, trendingUpOutline, trendingDownOutline,
    documentTextOutline, arrowUndoOutline, addOutline,
    removeOutline, pricetagOutline, createOutline
} from 'ionicons/icons';

import { KardexInventario } from '../../models/kardex.model';
import { InventarioService } from '../../services/inventario.service';
import { LoggerService } from '@core/services/logger.service';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { AjusteStockModalComponent, AjusteStockResult } from '../../components/ajuste-stock-modal/ajuste-stock-modal.component';

@Component({
    selector: 'app-kardex',
    templateUrl: './kardex.page.html',
    styleUrls: ['./kardex.page.scss'],
    standalone: true,
    imports: [
        FormsModule,
        IonHeader, IonToolbar, IonButtons, IonButton, IonTitle,
        IonContent, IonRefresher, IonRefresherContent,
        IonCard, IonCardContent, IonIcon, IonSpinner,
        EmptyStateComponent
    ]
})
export class KardexPage implements OnInit {
    private navCtrl       = inject(NavController);
    private modalCtrl     = inject(ModalController);
    private route         = inject(ActivatedRoute);
    private inventarioService = inject(InventarioService);
    private logger        = inject(LoggerService);

    productoId!: string;
    productoNombre = 'Producto';
    templateNombre: string | null = null;
    stockActual = 0;
    unidadMedida = 'und';
    esPeso = false;

    kardex: KardexInventario[] = [];
    cargando = true;

    constructor() {
        addIcons({
            arrowBackOutline, timeOutline, trendingUpOutline, trendingDownOutline,
            documentTextOutline, arrowUndoOutline, addOutline,
            removeOutline, pricetagOutline, createOutline
        });
    }

    async ngOnInit() {
        this.productoId = this.route.snapshot.paramMap.get('id')!;

        const producto = await this.inventarioService.obtenerProductoPorId(this.productoId);
        if (producto) {
            this.esPeso        = producto.tipo_venta === 'PESO';
            this.unidadMedida  = producto.unidad_medida || 'und';
            this.stockActual   = producto.stock_actual;
            this.productoNombre = producto.nombre;
            this.templateNombre = producto.producto_template?.nombre ?? null;
        }

        await this.cargarKardex();
    }

    async cargarKardex(silencioso = false) {
        if (!silencioso) this.cargando = true;
        try {
            this.kardex = await this.inventarioService.obtenerKardexProducto(this.productoId);
        } catch (e) {
            this.logger.error('KardexPage', 'Error cargando kardex', e);
        } finally {
            this.cargando = false;
        }
    }

    async handleRefresh(event: CustomEvent) {
        await this.cargarKardex(true);
        (event.target as HTMLIonRefresherElement).complete();
    }

    /**
     * El kárdex tiene dos orígenes válidos: desde editar (botón "Kárdex") y desde el
     * listado (menú ⋮ → "Ver kárdex"). `back()` sin destino explícito respeta el
     * historial real de Ionic y vuelve a donde el usuario vino realmente, en vez de
     * forzar siempre "editar" (que mandaría al listado a la página de editar un
     * producto al que nunca navegó).
     */
    volver() {
        this.navCtrl.back();
    }

    async abrirAjuste() {
        const modal = await this.modalCtrl.create({
            component: AjusteStockModalComponent,
            componentProps: {
                stockActual:  this.stockActual,
                esPeso:       this.esPeso,
                unidadMedida: this.unidadMedida,
                // El modal espera esta promesa antes de cerrarse (patrón de
                // PresentacionModalComponent.onConfirmar) — así "Procesando..." es
                // visible de verdad, y si falla el modal sigue abierto para reintentar.
                onConfirmar: (data: AjusteStockResult) => this.ejecutarAjuste(data)
            },
            cssClass: 'bottom-sheet-modal',
            breakpoints: [0, 1],
            initialBreakpoint: 1
        });
        await modal.present();
    }

    private async ejecutarAjuste(data: AjusteStockResult): Promise<boolean> {
        try {
            const res = await this.inventarioService.ajustarStock(
                this.productoId, data.tipo, data.cantidad, data.observaciones
            );
            this.stockActual = res.stock_nuevo;
            await this.cargarKardex();
            return true;
        } catch (error) {
            this.logger.error('KardexPage', 'Error ajustando stock', error);
            return false;
        }
    }

    // ── Helpers de presentación ──

    getIconoMovimiento(tipo: string): string {
        switch (tipo) {
            case 'VENTA':           return 'trending-down-outline';
            case 'COMPRA':          return 'trending-up-outline';
            case 'AJUSTE_POSITIVO': return 'add-outline';
            case 'AJUSTE_NEGATIVO': return 'remove-outline';
            case 'ANULACION_VENTA': return 'arrow-undo-outline';
            default:                return 'document-text-outline';
        }
    }

    getColorMovimiento(tipo: string): string {
        switch (tipo) {
            case 'VENTA':           return 'danger';
            case 'COMPRA':          return 'success';
            case 'AJUSTE_POSITIVO': return 'success';
            case 'AJUSTE_NEGATIVO': return 'danger';
            case 'ANULACION_VENTA': return 'tertiary';
            default:                return 'medium';
        }
    }

    getLabelMovimiento(tipo: string): string {
        switch (tipo) {
            case 'VENTA':           return 'Venta';
            case 'COMPRA':          return 'Compra';
            case 'AJUSTE_POSITIVO': return 'Ajuste +';
            case 'AJUSTE_NEGATIVO': return 'Ajuste -';
            case 'ANULACION_VENTA': return 'Anulación';
            default:                return tipo;
        }
    }

    esEgreso(tipo: string): boolean {
        return tipo === 'VENTA' || tipo === 'AJUSTE_NEGATIVO';
    }

    formatDate(dateStr: string): string {
        return new Date(dateStr).toLocaleString('es-EC', {
            year: 'numeric', month: 'short', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    }
}
