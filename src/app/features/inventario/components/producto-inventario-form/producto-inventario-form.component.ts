import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import {
    IonItem, IonInput, IonIcon, IonButton
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { documentTextOutline } from 'ionicons/icons';
import { NumbersOnlyDirective } from '../../../../shared/directives/numbers-only.directive';

@Component({
    selector: 'app-producto-inventario-form',
    templateUrl: './producto-inventario-form.component.html',
    styleUrls: ['./producto-inventario-form.component.scss'],
    standalone: true,
    imports: [
        ReactiveFormsModule,
        IonItem, IonInput, IonIcon, IonButton,
        NumbersOnlyDirective,
    ]
})
export class ProductoInventarioFormComponent {
    /** FormGroup con: stock_actual, stock_minimo, tipo_venta, unidad_medida */
    @Input({ required: true }) formGroup!: FormGroup;
    @Input() modo: 'crear' | 'editar' = 'crear';

    /** Emitido cuando el usuario pulsa "Auditar Kardex" (solo modo editar) */
    @Output() abrirKardex = new EventEmitter<void>();

    constructor() {
        addIcons({ documentTextOutline });
    }

    get tipoVenta(): string {
        return this.formGroup.get('tipo_venta')?.value ?? 'UNIDAD';
    }

    get unidadMedida(): string {
        return this.formGroup.get('unidad_medida')?.value ?? 'und';
    }

    get labelStock(): string {
        return this.tipoVenta === 'PESO'
            ? `Stock Bodega (${this.unidadMedida}) *`
            : 'Stock Bodega *';
    }

    get inputmodeStock(): string {
        return this.tipoVenta === 'PESO' ? 'decimal' : 'numeric';
    }

    esCampoInvalido(campo: string): boolean {
        const ctrl = this.formGroup.get(campo);
        return !!(ctrl && ctrl.invalid && (ctrl.dirty || ctrl.touched));
    }
}
