import { Component, inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, calculatorOutline, refreshOutline } from 'ionicons/icons';
import { calcularMargenDesdePrecio, resolverPrecioYMargen } from '../../../core/utils/margen.util';
import { CurrencyService } from '@core/services/currency.service';

@Component({
    selector: 'app-calculadora-margen',
    templateUrl: './calculadora-margen.component.html',
    styleUrls: ['./calculadora-margen.component.scss'],
    standalone: true,
    imports: [CommonModule, FormsModule, IonButton, IonIcon]
})
export class CalculadoraMargenComponent {
    private modalCtrl = inject(ModalController);
    private currencyService = inject(CurrencyService);

    @ViewChild('costoInput') costoInputRef!: ElementRef<HTMLInputElement>;

    // costo y precioVenta son strings (input type="text"): el separador decimal lo maneja el
    // parse(), no el locale del navegador. precioVenta además se formatea a "0.20" (2 decimales).
    costo = '';
    precioVenta = '';
    margenPct: number = 20;

    constructor() {
        addIcons({ closeOutline, calculatorOutline, refreshOutline });
    }

    get costoNum(): number {
        return this.currencyService.parse(this.costo);
    }

    get precioVentaNum(): number {
        return this.currencyService.parse(this.precioVenta);
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

    get ganancia(): string {
        const venta = this.precioVentaNum;
        const costo = this.costoNum;
        if (!costo || !venta) return this.currencyService.format(0);
        const valor = Math.round((venta - costo) * 100) / 100;
        return this.currencyService.format(valor);
    }

    onCostoChange() {
        const costo = this.costoNum;
        if (costo <= 0) {
            this.precioVenta = '';
            this.margenPct = 20;
            return;
        }
        // Precio redondeado a centavo + margen real recalculado desde ese precio
        const { precio, margenReal } = resolverPrecioYMargen(costo, this.margenPct);
        this.precioVenta = this.currencyService.format(precio); // "0.20" siempre con 2 decimales
        this.margenPct = margenReal;
    }

    onPrecioVentaChange() {
        const venta = this.precioVentaNum;
        const costo = this.costoNum;
        if (costo <= 0 || venta <= 0) return;
        this.margenPct = calcularMargenDesdePrecio(costo, venta);
    }

    /** Reformatea el precio a 2 decimales cuando el usuario termina de editarlo a mano. */
    onPrecioBlur() {
        const venta = this.precioVentaNum;
        if (venta > 0) this.precioVenta = this.currencyService.format(venta);
    }

    limpiar() {
        this.costo = '';
        this.precioVenta = '';
        this.margenPct = 20;
        Promise.resolve().then(() => this.costoInputRef?.nativeElement?.focus());
    }

    cerrar() {
        this.modalCtrl.dismiss();
    }
}
