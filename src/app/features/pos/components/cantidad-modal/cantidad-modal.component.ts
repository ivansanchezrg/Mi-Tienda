import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon, IonSpinner, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, addOutline, removeOutline, scaleOutline, cubeOutline, trashOutline } from 'ionicons/icons';
import { CurrencyService } from '../../../../core/services/currency.service';

export interface CantidadModalResult {
    cantidad: number;
}

@Component({
    selector: 'app-cantidad-modal',
    templateUrl: './cantidad-modal.component.html',
    styleUrls: ['./cantidad-modal.component.scss'],
    standalone: true,
    imports: [CommonModule, FormsModule, IonButton, IonIcon, IonSpinner]
})
export class CantidadModalComponent implements OnInit {
    @Input() nombre!: string;
    @Input() precioUnitario!: number;
    @Input() unidadMedida: string = 'und';
    @Input() esPeso: boolean = false;
    @Input() stockDisponible!: number;
    @Input() cantidadActual: number = 0;
    @Input() esEdicion: boolean = false;
    @Input() imagenUrl?: string;

    protected currencyService = inject(CurrencyService);
    private modalCtrl = inject(ModalController);

    cantidad: number | null = null;
    cantidadStr = '';
    error = '';
    stockBadgeAnimando = false;

    constructor() {
        addIcons({ closeOutline, addOutline, removeOutline, scaleOutline, cubeOutline, trashOutline });
    }

    ngOnInit() {
        if (this.esEdicion && this.cantidadActual > 0) {
            this.cantidad = this.cantidadActual;
            this.cantidadStr = this.cantidadActual.toString();
        }
    }


    get stockRestante(): number {
        const cantidadIngresada = this.cantidad ?? (this.esEdicion ? this.cantidadActual : 0);
        return Math.max(0, this.maxPermitido - cantidadIngresada);
    }

    get stockLabel(): string {
        if (this.esPeso) return `${this.stockRestante} ${this.unidadMedida}`;
        return `${this.stockRestante} und`;
    }

    get precioLabel(): string {
        const f = this.currencyService.format(this.precioUnitario);
        return this.esPeso ? `$${f}/${this.unidadMedida}` : `$${f} c/u`;
    }

    get subtotal(): number {
        if (!this.cantidad || this.cantidad <= 0) return 0;
        return Math.round(this.cantidad * this.precioUnitario * 100) / 100;
    }

    get maxPermitido(): number {
        return this.esEdicion ? this.stockDisponible : this.stockDisponible - this.cantidadActual;
    }

    private dispararBounceStockBadge() {
        if (this.stockBadgeAnimando) return;
        this.stockBadgeAnimando = true;
        setTimeout(() => this.stockBadgeAnimando = false, 450);
    }

    /** Acepta coma o punto como separador decimal (teclados Android configurados con coma). */
    private parseCantidad(val: string): number {
        const normalizado = val.replace(',', '.');
        return this.esPeso ? parseFloat(normalizado) : parseInt(normalizado, 10);
    }

    onInput(event: Event) {
        const prevRestante = this.stockRestante;
        const val = (event.target as HTMLInputElement).value;
        this.cantidadStr = val;
        const parsed = this.parseCantidad(val);
        this.cantidad = isNaN(parsed) ? null : parsed;
        this.error = '';
        if (this.stockRestante <= 10 && this.stockRestante < prevRestante) {
            this.dispararBounceStockBadge();
        }
    }

    incrementar() {
        const current = this.cantidad ?? 0;
        const step = this.esPeso ? 0.5 : 1;
        if (current < this.maxPermitido) {
            const next = Math.round((current + step) * 1000) / 1000;
            this.cantidad = next;
            this.cantidadStr = next.toString();
            this.error = '';
            if (this.stockRestante <= 10) this.dispararBounceStockBadge();
        }
    }

    decrementar() {
        const current = this.cantidad ?? 0;
        const step = this.esPeso ? 0.5 : 1;
        const minimo = this.esPeso ? 0 : 1;
        if (current > minimo) {
            const next = Math.round((current - step) * 1000) / 1000;
            this.cantidad = next;
            this.cantidadStr = next.toString();
            this.error = '';
        }
    }

    // Feedback inmediato: el dismiss de un bottom-sheet en Android anima ~300ms y tras
    // cerrar el POS aún resuelve la imagen del ítem. Sin este flag el botón parece
    // "trabado". Marcarlo disabled + spinner da respuesta al toque al instante.
    cerrando = false;

    confirmar() {
        if (this.cerrando) return; // anti doble-tap
        const cant = this.parseCantidad(this.cantidadStr);

        if (!cant || isNaN(cant) || cant <= 0) {
            this.error = 'Ingresa una cantidad válida';
            return;
        }
        if (cant > this.maxPermitido) {
            const maxLabel = this.esPeso ? `${this.maxPermitido} ${this.unidadMedida}` : `${this.maxPermitido} und`;
            this.error = `Máximo disponible: ${maxLabel}`;
            return;
        }

        const cantFinal = this.esPeso ? Math.round(cant * 1000) / 1000 : cant;
        this.cerrando = true;
        this.modalCtrl.dismiss({ cantidad: cantFinal } as CantidadModalResult, 'confirm');
    }

    quitar() {
        if (this.cerrando) return;
        this.cerrando = true;
        this.modalCtrl.dismiss(null, 'quitar');
    }

    cancelar() {
        if (this.cerrando) return;
        this.cerrando = true;
        this.modalCtrl.dismiss(null, 'cancel');
    }
}
