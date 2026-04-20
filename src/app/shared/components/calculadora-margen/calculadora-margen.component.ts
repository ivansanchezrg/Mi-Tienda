import { Component, inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, calculatorOutline } from 'ionicons/icons';
import { calcularPrecioDesdeMargen, calcularMargenDesdePrecio } from '../../../core/utils/margen.util';

@Component({
    selector: 'app-calculadora-margen',
    templateUrl: './calculadora-margen.component.html',
    styleUrls: ['./calculadora-margen.component.scss'],
    standalone: true,
    imports: [CommonModule, FormsModule, IonButton, IonIcon]
})
export class CalculadoraMargenComponent {
    private modalCtrl = inject(ModalController);

    @ViewChild('costoInput') costoInputRef!: ElementRef<HTMLInputElement>;

    costo: number | null = null;
    precioVenta: number | null = null;
    margenPct: number = 20;

    constructor() {
        addIcons({ closeOutline, calculatorOutline });
    }

    get margenColor(): string {
        if (this.margenPct < 15) return 'danger';
        if (this.margenPct < 30) return 'warning';
        return 'success';
    }

    get margenLabel(): string {
        if (this.margenPct < 15) return 'Margen bajo';
        if (this.margenPct < 30) return 'Margen moderado';
        return 'Buen margen';
    }

    get ganancia(): number {
        if (!this.costo || !this.precioVenta) return 0;
        return Math.round((this.precioVenta - this.costo) * 100) / 100;
    }

    onCostoChange() {
        if (!this.costo || this.costo <= 0) {
            this.precioVenta = null;
            this.margenPct = 20;
            return;
        }
        this.precioVenta = calcularPrecioDesdeMargen(this.costo, this.margenPct);
    }

    onPrecioVentaChange() {
        if (!this.costo || this.costo <= 0 || !this.precioVenta || this.precioVenta <= 0) return;
        this.margenPct = calcularMargenDesdePrecio(this.costo, this.precioVenta);
    }

    limpiar() {
        this.costo = null;
        this.precioVenta = null;
        this.margenPct = 20;
        setTimeout(() => this.costoInputRef?.nativeElement?.focus(), 50);
    }

    cerrar() {
        this.modalCtrl.dismiss();
    }
}
