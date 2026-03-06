import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { closeOutline, timeOutline, trendingUpOutline, trendingDownOutline, documentTextOutline, swapHorizontalOutline } from 'ionicons/icons';

import { KardexInventario } from '../../models/kardex.model';
import { InventarioService } from '../../services/inventario.service';

@Component({
    selector: 'app-kardex-modal',
    templateUrl: './kardex-modal.component.html',
    styleUrls: ['./kardex-modal.component.scss'],
    standalone: true,
    imports: [IonicModule, CommonModule]
})
export class KardexModalComponent implements OnInit {
    @Input() productoId!: string;
    @Input() productoNombre: string = 'Producto';

    private modalCtrl = inject(ModalController);
    private inventarioService = inject(InventarioService);

    kardex: KardexInventario[] = [];
    cargando = true;

    constructor() {
        addIcons({ closeOutline, timeOutline, trendingUpOutline, trendingDownOutline, documentTextOutline, swapHorizontalOutline });
    }

    ngOnInit() {
        this.cargarKardex();
    }

    async cargarKardex() {
        this.cargando = true;
        try {
            this.kardex = await this.inventarioService.obtenerKardexProducto(this.productoId);
        } catch (e) {
            console.error('Error cargando kardex', e);
        } finally {
            this.cargando = false;
        }
    }

    cerrar() {
        this.modalCtrl.dismiss();
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
            case 'AJUSTE_NEGATIVO': return 'warning';
            case 'ANULACION_VENTA': return 'tertiary';
            default: return 'medium';
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
