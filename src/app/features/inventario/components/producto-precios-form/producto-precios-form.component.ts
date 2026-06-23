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
import { calcularMargenDesdePrecio, resolverPrecioYMargen } from '../../../../core/utils/margen.util';

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

    margenPct      = 20;
    margenAbsoluto = 0;
    private _precioEditadoManualmente = false;

    private costoSub!: Subscription;
    private ventaSub!: Subscription;

    constructor() {
        addIcons({ trendingUpOutline, checkmarkCircleOutline, informationCircleOutline });
    }

    ngOnInit() {
        // En modo editar los valores ya están cargados — el precio fue ingresado por el usuario
        if (this.costoActual > 0 && this.ventaActual > 0) {
            this._precioEditadoManualmente = true;
            this._recalcularMargen();
        }

        this.costoSub = this.formGroup.get('precio_costo')!.valueChanges.subscribe(() => {
            const costo = this.costoActual;
            if (costo <= 0) {
                // Costo borrado: limpiar precio siempre y resetear margen
                this.formGroup.get('precio_venta')!.setValue('', { emitEvent: false });
                this._precioEditadoManualmente = false;
                this.margenPct = 20;
                this.margenAbsoluto = 0;
                return;
            }
            if (!this._precioEditadoManualmente) {
                // Precio no tocado: calcular automáticamente con el margen objetivo actual.
                // resolverPrecioYMargen redondea el precio a centavo y devuelve el margen real.
                const { precio, margenReal } = resolverPrecioYMargen(costo, this.margenPct);
                this.formGroup.get('precio_venta')!.setValue(
                    this.currencyService.format(precio),
                    { emitEvent: false }
                );
                this.margenPct = margenReal;
                this.margenAbsoluto = Math.round((precio - costo) * 100) / 100;
            } else {
                this._recalcularMargen();
            }
            this.costoChange.emit(costo);
        });

        this.ventaSub = this.formGroup.get('precio_venta')!.valueChanges.subscribe(() => {
            const venta = this.ventaActual;
            // Usuario borró el precio: volver a modo automático
            this._precioEditadoManualmente = venta > 0;
            this._recalcularMargen();
            this.ventaChange.emit(venta);
        });
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
