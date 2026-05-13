import { Component, Input, OnInit, AfterViewInit, inject, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, checkmarkOutline, addOutline, removeOutline, scaleOutline, cubeOutline } from 'ionicons/icons';
import { CurrencyService } from '../../../../core/services/currency.service';
import { NumbersOnlyDirective } from '../../../../shared/directives/numbers-only.directive';

export interface CantidadModalResult {
    cantidad: number;
}

@Component({
    selector: 'app-cantidad-modal',
    templateUrl: './cantidad-modal.component.html',
    styleUrls: ['./cantidad-modal.component.scss'],
    standalone: true,
    imports: [CommonModule, FormsModule, IonButton, IonIcon, NumbersOnlyDirective]
})
export class CantidadModalComponent implements OnInit, AfterViewInit {
    @ViewChild('cantidadInput') cantidadInputRef!: ElementRef<HTMLInputElement>;
    @Input() nombre!: string;
    @Input() precioUnitario!: number;
    @Input() unidadMedida: string = 'und';
    @Input() esPeso: boolean = false;
    @Input() stockDisponible!: number;
    @Input() cantidadActual: number = 0;   // 0 = nuevo, >0 = editar
    @Input() esEdicion: boolean = false;

    protected currencyService = inject(CurrencyService);
    private modalCtrl = inject(ModalController);

    cantidad: number | null = null;
    cantidadStr = '';
    error = '';

    constructor() {
        addIcons({ closeOutline, checkmarkOutline, addOutline, removeOutline, scaleOutline, cubeOutline });
    }

    ngOnInit() {
        if (this.esEdicion && this.cantidadActual > 0) {
            this.cantidad = this.cantidadActual;
            this.cantidadStr = this.cantidadActual.toString();
        }
    }

    ngAfterViewInit() {
        // Pequeño delay para que el modal termine su animación antes de hacer focus
        setTimeout(() => {
            this.cantidadInputRef?.nativeElement?.focus();
        }, 300);
    }

    limpiarInput() {
        this.cantidad = null;
        this.cantidadStr = '';
        this.error = '';
        setTimeout(() => this.cantidadInputRef?.nativeElement?.focus(), 50);
    }

    get stockLabel(): string {
        if (this.esPeso) return `${this.stockDisponible} ${this.unidadMedida}`;
        return `${this.stockDisponible} und`;
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
        if (this.esPeso) {
            // Para PESO: stock menos lo que ya estaba en carrito
            return this.esEdicion ? this.stockDisponible : this.stockDisponible - this.cantidadActual;
        }
        return this.esEdicion ? this.stockDisponible : this.stockDisponible - this.cantidadActual;
    }

    onInput(event: Event) {
        const val = (event.target as HTMLInputElement).value;
        this.cantidadStr = val;
        this.cantidad = this.esPeso ? parseFloat(val) : parseInt(val, 10);
        this.error = '';
    }

    incrementar() {
        if (this.esPeso) return; // Solo para unidades
        const current = this.cantidad ?? 0;
        if (current < this.maxPermitido) {
            this.cantidad = current + 1;
            this.cantidadStr = this.cantidad.toString();
            this.error = '';
        }
    }

    decrementar() {
        if (this.esPeso) return;
        const current = this.cantidad ?? 0;
        const min = this.esEdicion ? 1 : 1;
        if (current > min) {
            this.cantidad = current - 1;
            this.cantidadStr = this.cantidad.toString();
            this.error = '';
        }
    }

    confirmar() {
        const cant = this.esPeso
            ? parseFloat(this.cantidadStr)
            : parseInt(this.cantidadStr, 10);

        if (!cant || isNaN(cant) || cant <= 0) {
            this.error = 'Ingresa una cantidad válida';
            return;
        }
        if (cant > this.maxPermitido) {
            this.error = `Máximo disponible: ${this.stockLabel}`;
            return;
        }

        const cantFinal = this.esPeso ? Math.round(cant * 1000) / 1000 : cant;
        this.modalCtrl.dismiss({ cantidad: cantFinal } as CantidadModalResult, 'confirm');
    }

    cancelar() {
        this.modalCtrl.dismiss(null, 'cancel');
    }
}
