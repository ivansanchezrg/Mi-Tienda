import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, NavController } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { addIcons } from 'ionicons';
import {
    arrowBackOutline, timeOutline, trendingUpOutline, trendingDownOutline,
    documentTextOutline, swapHorizontalOutline, addOutline, checkmarkOutline,
    closeOutline, arrowUpOutline, removeOutline
} from 'ionicons/icons';

import { KardexInventario } from '../../models/kardex.model';
import { InventarioService } from '../../services/inventario.service';
import { UiService } from '../../../../core/services/ui.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';

type TipoAjuste = 'COMPRA' | 'AJUSTE_POSITIVO' | 'AJUSTE_NEGATIVO';

@Component({
    selector: 'app-kardex',
    templateUrl: './kardex.page.html',
    styleUrls: ['./kardex.page.scss'],
    standalone: true,
    imports: [IonicModule, CommonModule, FormsModule, EmptyStateComponent]
})
export class KardexPage implements OnInit {
    private navCtrl = inject(NavController);
    private route = inject(ActivatedRoute);
    private inventarioService = inject(InventarioService);
    private ui = inject(UiService);
    private logger = inject(LoggerService);

    productoId!: string;
    productoNombre = 'Producto';
    stockActual = 0;
    unidadMedida = 'und';
    esPeso = false;

    kardex: KardexInventario[] = [];
    cargando = true;

    // Formulario de ajuste
    mostrarFormAjuste = false;
    guardandoAjuste = false;
    tipoAjuste: TipoAjuste = 'COMPRA';
    cantidad: number | null = null;
    observaciones = '';

    constructor() {
        addIcons({
            arrowBackOutline, timeOutline, trendingUpOutline, trendingDownOutline,
            documentTextOutline, swapHorizontalOutline, addOutline, checkmarkOutline,
            closeOutline, arrowUpOutline, removeOutline
        });
    }

    async ngOnInit() {
        this.productoId = this.route.snapshot.paramMap.get('id')!;
        this.productoNombre = this.route.snapshot.queryParamMap.get('nombre') || 'Producto';
        this.stockActual = Number(this.route.snapshot.queryParamMap.get('stock')) || 0;

        // Cargar producto para detectar padre-hijo y tipo_venta
        const producto = await this.inventarioService.obtenerProductoPorId(this.productoId);
        if (producto) {
            // Si es padre (empaque), redirigir al kardex del hijo
            if (producto.producto_hijo_id) {
                const hijo = await this.inventarioService.obtenerProductoPorId(producto.producto_hijo_id);
                if (hijo) {
                    this.productoId = hijo.id;
                    this.productoNombre = hijo.nombre;
                    this.stockActual = hijo.stock_actual;
                    this.esPeso = hijo.tipo_venta === 'PESO';
                    this.unidadMedida = hijo.unidad_medida || 'und';
                }
            } else {
                this.esPeso = producto.tipo_venta === 'PESO';
                this.unidadMedida = producto.unidad_medida || 'und';
                this.stockActual = producto.stock_actual;
            }
        }

        await this.cargarKardex();
    }

    async cargarKardex() {
        this.cargando = true;
        try {
            this.kardex = await this.inventarioService.obtenerKardexProducto(this.productoId);
        } catch (e) {
            this.logger.error('KardexPage', 'Error cargando kardex', e);
        } finally {
            this.cargando = false;
        }
    }

    volver() {
        this.navCtrl.back();
    }

    toggleFormAjuste() {
        this.mostrarFormAjuste = !this.mostrarFormAjuste;
        if (!this.mostrarFormAjuste) this.resetForm();
    }

    seleccionarTipo(tipo: TipoAjuste) {
        this.tipoAjuste = tipo;
    }

    get esIngreso(): boolean {
        return this.tipoAjuste === 'COMPRA' || this.tipoAjuste === 'AJUSTE_POSITIVO';
    }

    async confirmarAjuste() {
        if (!this.cantidad || this.cantidad <= 0) {
            this.ui.showToast('Ingresa una cantidad válida', 'warning');
            return;
        }
        if (!this.observaciones.trim()) {
            this.ui.showToast('Las observaciones son obligatorias', 'warning');
            return;
        }

        this.guardandoAjuste = true;
        try {
            const res = await this.inventarioService.ajustarStock(
                this.productoId,
                this.tipoAjuste,
                this.cantidad,
                this.observaciones.trim()
            );
            this.stockActual = res.stock_nuevo;
            this.mostrarFormAjuste = false;
            this.resetForm();
            await this.cargarKardex();
        } catch (error) {
            this.logger.error('KardexPage', 'Error ajustando stock', error);
        } finally {
            this.guardandoAjuste = false;
        }
    }

    private resetForm() {
        this.tipoAjuste = 'COMPRA';
        this.cantidad = null;
        this.observaciones = '';
    }

    getIconoMovimiento(tipo: string): string {
        switch (tipo) {
            case 'VENTA': return 'trending-down-outline';
            case 'COMPRA': return 'trending-up-outline';
            case 'AJUSTE_POSITIVO': return 'trending-up-outline';
            case 'AJUSTE_NEGATIVO': return 'trending-down-outline';
            case 'ANULACION_VENTA': return 'swap-horizontal-outline';
            default: return 'document-text-outline';
        }
    }

    getColorMovimiento(tipo: string): string {
        switch (tipo) {
            case 'VENTA': return 'danger';
            case 'COMPRA': return 'success';
            case 'AJUSTE_POSITIVO': return 'success';
            case 'AJUSTE_NEGATIVO': return 'danger';
            case 'ANULACION_VENTA': return 'tertiary';
            default: return 'medium';
        }
    }

    getLabelMovimiento(tipo: string): string {
        switch (tipo) {
            case 'VENTA': return 'Venta';
            case 'COMPRA': return 'Compra';
            case 'AJUSTE_POSITIVO': return 'Ajuste +';
            case 'AJUSTE_NEGATIVO': return 'Ajuste -';
            case 'ANULACION_VENTA': return 'Anulación';
            default: return tipo;
        }
    }

    formatDate(dateStr: string): string {
        const d = new Date(dateStr);
        return d.toLocaleString('es-EC', {
            year: 'numeric', month: 'short', day: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    }
}
