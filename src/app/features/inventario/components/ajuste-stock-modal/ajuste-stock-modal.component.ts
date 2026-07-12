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

/**
 * Mismo patrón que PresentacionModalComponent.onConfirmar: el modal ejecuta el callback
 * y espera su resultado ANTES de cerrarse, en vez de cerrarse al instante y dejar que el
 * caller guarde después (con ese flujo el spinner "Procesando..." nunca llegaba a
 * mostrarse — el modal ya no existía cuando `guardando` pasaba a true). Si el callback
 * devuelve false o lanza, el modal sigue abierto con cantidad/observaciones intactas
 * para reintentar. `HTMLIonModalElement` no expone `componentInstance` en su tipado
 * público, así que un @Output() no es alcanzable desde el caller — de ahí el callback.
 */
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

    /** Ejecuta el ajuste real; retorna true si tuvo éxito (el modal solo se cierra en ese caso). */
    @Input({ required: true }) onConfirmar!: (result: AjusteStockResult) => Promise<boolean>;

    private modalCtrl = inject(ModalController);

    tipoAjuste: TipoAjuste = 'COMPRA';
    cantidad: number | null = null;
    observaciones = '';
    guardando = false;

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

    async confirmar() {
        if (this.confirmarDeshabilitado) return;

        this.guardando = true;
        const result: AjusteStockResult = {
            tipo: this.tipoAjuste,
            cantidad: this.cantidad!,
            observaciones: this.observaciones.trim()
        };

        try {
            const exito = await this.onConfirmar(result);
            if (exito) this.modalCtrl.dismiss();
        } finally {
            this.guardando = false;
        }
    }

    cerrar() {
        if (this.guardando) return;
        this.modalCtrl.dismiss(null);
    }
}
