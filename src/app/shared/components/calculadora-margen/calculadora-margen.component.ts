import { Component, inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, calculatorOutline } from 'ionicons/icons';

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
    margenPct = 20; // default razonable para retail

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
            return;
        }
        this.precioVenta = this.calcularPrecioVenta(this.costo, this.margenPct);
    }

    onSliderChange() {
        if (!this.costo || this.costo <= 0) return;
        this.precioVenta = this.calcularPrecioVenta(this.costo, this.margenPct);
    }

    onPrecioVentaChange() {
        if (!this.costo || this.costo <= 0 || !this.precioVenta || this.precioVenta <= 0) return;
        if (this.precioVenta <= this.costo) {
            this.margenPct = 0;
            return;
        }
        // markup sobre costo: (venta - costo) / costo * 100
        this.margenPct = Math.round(((this.precioVenta - this.costo) / this.costo) * 100);
    }

    private calcularPrecioVenta(costo: number, margenPct: number): number {
        // precio = costo * (1 + margen/100)  → markup sobre costo
        const precio = costo * (1 + margenPct / 100);
        return Math.round(precio * 100) / 100;
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
