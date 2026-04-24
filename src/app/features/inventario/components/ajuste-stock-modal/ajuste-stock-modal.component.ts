import { Component, Input, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalController } from '@ionic/angular/standalone';
import {
    IonIcon, IonButton, IonInput, IonItem, IonSpinner
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    closeOutline, trendingUpOutline, addOutline, removeOutline, checkmarkOutline
} from 'ionicons/icons';

export type TipoAjuste = 'COMPRA' | 'AJUSTE_POSITIVO' | 'AJUSTE_NEGATIVO';

export interface AjusteStockResult {
    tipo: TipoAjuste;
    cantidad: number;
    observaciones: string;
}

@Component({
    selector: 'app-ajuste-stock-modal',
    templateUrl: './ajuste-stock-modal.component.html',
    styleUrls: ['./ajuste-stock-modal.component.scss'],
    standalone: true,
    imports: [FormsModule, IonIcon, IonButton, IonInput, IonItem, IonSpinner]
})
export class AjusteStockModalComponent {
    @Input() stockActual = 0;
    @Input() esPeso = false;
    @Input() unidadMedida = 'und';
    @Input() guardando = false;

    private modalCtrl = inject(ModalController);

    tipoAjuste: TipoAjuste = 'COMPRA';
    cantidad: number | null = null;
    observaciones = '';

    constructor() {
        addIcons({ closeOutline, trendingUpOutline, addOutline, removeOutline, checkmarkOutline });
    }

    get esIngreso(): boolean {
        return this.tipoAjuste === 'COMPRA' || this.tipoAjuste === 'AJUSTE_POSITIVO';
    }

    get stockResultante(): number {
        if (!this.cantidad || this.cantidad <= 0) return this.stockActual;
        return this.esIngreso
            ? this.stockActual + this.cantidad
            : this.stockActual - this.cantidad;
    }

    get confirmarDeshabilitado(): boolean {
        return this.guardando
            || !this.cantidad
            || this.cantidad <= 0
            || !this.observaciones.trim();
    }

    seleccionarTipo(tipo: TipoAjuste) {
        this.tipoAjuste = tipo;
    }

    confirmar() {
        if (this.confirmarDeshabilitado) return;
        this.modalCtrl.dismiss({
            tipo: this.tipoAjuste,
            cantidad: this.cantidad,
            observaciones: this.observaciones.trim()
        } as AjusteStockResult);
    }

    cerrar() {
        this.modalCtrl.dismiss(null);
    }
}
