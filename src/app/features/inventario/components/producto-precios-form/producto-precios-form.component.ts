import { Component, Input, Output, EventEmitter, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
    IonItem, IonInput, IonIcon, IonToggle
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    trendingUpOutline, checkmarkCircleOutline, informationCircleOutline
} from 'ionicons/icons';
import { NumbersOnlyDirective } from '../../../../shared/directives/numbers-only.directive';
import { CurrencyInputDirective } from '../../../../shared/directives/currency-input.directive';
import { CurrencyService } from '../../../../core/services/currency.service';
import { calcularMargenDesdePrecio } from '../../../../core/utils/margen.util';

@Component({
    selector: 'app-producto-precios-form',
    templateUrl: './producto-precios-form.component.html',
    styleUrls: ['./producto-precios-form.component.scss'],
    standalone: true,
    imports: [
        CommonModule, ReactiveFormsModule,
        IonItem, IonInput, IonIcon, IonToggle,
        NumbersOnlyDirective, CurrencyInputDirective,
    ]
})
export class ProductoPreciosFormComponent implements OnInit, OnDestroy {
    /** FormGroup con: precio_costo, precio_venta, tiene_iva */
    @Input({ required: true }) formGroup!: FormGroup;

    @Output() costoChange   = new EventEmitter<number>();
    @Output() ventaChange   = new EventEmitter<number>();

    protected currencyService = inject(CurrencyService);

    margenPct     = 20;
    margenAbsoluto = 0;

    private costoSub!: Subscription;
    private ventaSub!: Subscription;

    constructor() {
        addIcons({ trendingUpOutline, checkmarkCircleOutline, informationCircleOutline });
    }

    ngOnInit() {
        this.costoSub = this.formGroup.get('precio_costo')!.valueChanges.subscribe(() => {
            this._recalcularMargen();
            this.costoChange.emit(this.costoActual);
        });
        this.ventaSub = this.formGroup.get('precio_venta')!.valueChanges.subscribe(() => {
            this._recalcularMargen();
            this.ventaChange.emit(this.ventaActual);
        });

        // Inicializar margen si ya hay valores (modo editar)
        if (this.costoActual > 0 && this.ventaActual > 0) {
            this._recalcularMargen();
        }
    }

    get costoActual(): number {
        const raw = this.currencyService.parse(this.formGroup.get('precio_costo')?.value ?? 0);
        return Math.round(raw * 100) / 100;
    }

    get ventaActual(): number {
        const raw = this.currencyService.parse(this.formGroup.get('precio_venta')?.value ?? 0);
        return Math.round(raw * 100) / 100;
    }

    private _recalcularMargen() {
        const costo = this.costoActual;
        const venta = this.ventaActual;
        this.margenPct = calcularMargenDesdePrecio(costo, venta);
        this.margenAbsoluto = venta > costo ? Math.round((venta - costo) * 100) / 100 : 0;
    }

    esCampoInvalido(campo: string): boolean {
        const ctrl = this.formGroup.get(campo);
        return !!(ctrl && ctrl.invalid && (ctrl.dirty || ctrl.touched));
    }

    ngOnDestroy() {
        this.costoSub?.unsubscribe();
        this.ventaSub?.unsubscribe();
    }
}
