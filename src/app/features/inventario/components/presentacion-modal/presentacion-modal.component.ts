import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { IonButton, IonIcon, IonSpinner, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, layersOutline, barcodeOutline, informationCircleOutline, trendingUpOutline, trendingDownOutline, removeOutline, checkmarkCircleOutline, sparklesOutline } from 'ionicons/icons';
import { UiService } from '../../../../core/services/ui.service';
import { BarcodeScannerService } from '../../../../core/services/barcode-scanner.service';

import { CurrencyInputDirective } from '../../../../shared/directives/currency-input.directive';
import { NumbersOnlyDirective } from '../../../../shared/directives/numbers-only.directive';
import { UppercaseInputDirective } from '../../../../shared/directives/uppercase-input.directive';
import { CurrencyService } from '../../../../core/services/currency.service';
import { calcularPrecioDesdeMargen, calcularMargenDesdePrecio } from '../../../../core/utils/margen.util';

export interface PresentacionModalResult {
    nombre: string;
    factor_conversion: number;
    precio_venta: number;
    precio_costo: number;
    codigo_barras?: string;
}

@Component({
    selector: 'app-presentacion-modal',
    templateUrl: './presentacion-modal.component.html',
    styleUrls: ['./presentacion-modal.component.scss'],
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        IonButton,
        IonIcon,
        IonSpinner,
        CurrencyInputDirective,
        NumbersOnlyDirective,
        UppercaseInputDirective,
    ]
})
export class PresentacionModalComponent implements OnInit {

    /** Nombres ya existentes para validar duplicados (excluye el nombre actual al editar) */
    @Input() nombresExistentes: string[] = [];

    /** Si se pasa, el modal opera en modo EDITAR con los valores precargados */
    @Input() presentacionActual?: PresentacionModalResult;

    /** Precio de venta del producto base — para mostrar el margen calculado */
    @Input() precioBase = 0;

    /** Nombre del producto padre — se muestra como subtítulo en el header */
    @Input() nombreProducto = '';

    /**
     * Callback que ejecuta la operación de BD.
     * Retorna true si fue exitoso — el modal solo se cierra en ese caso.
     * En modo CREAR (en memoria) no se pasa — el modal cierra directamente.
     */
    @Input() onConfirmar?: (result: PresentacionModalResult) => Promise<boolean>;

    private modalCtrl = inject(ModalController);
    private fb = inject(FormBuilder);
    private ui = inject(UiService);
    private barcodeScanner = inject(BarcodeScannerService);
    public currencyService = inject(CurrencyService);

    form!: FormGroup;
    guardando = false;
    margenPct: number = 20;

    get modo(): 'CREAR' | 'EDITAR' {
        return this.presentacionActual ? 'EDITAR' : 'CREAR';
    }

    get margenColor(): string {
        if (this.margenPct < 15) return 'danger';
        if (this.margenPct < 30) return 'warning';
        return 'success';
    }

    /** Costo real del pack: precio_costo propio si está ingresado, sino precioBase * factor */
    get costoPack(): number {
        const factor = Number(this.form?.get('factor_conversion')?.value ?? 0);
        const costoPropio = this.currencyService.parse(this.form?.get('precio_costo')?.value ?? 0);
        if (costoPropio > 0) return costoPropio;
        if (!factor || !this.precioBase) return 0;
        return this.precioBase * factor;
    }

    get margenAbsoluto(): number {
        const precio = this.currencyService.parse(this.form?.get('precio_venta')?.value ?? 0);
        const costo = this.costoPack;
        if (!precio || !costo || precio < costo) return 0;
        return precio - costo;
    }

    get stockEquivalente(): string {
        const factor = Number(this.form?.get('factor_conversion')?.value ?? 0);
        if (!factor || factor < 1) return '';
        return `1 paquete = ${factor} unidad${factor !== 1 ? 'es' : ''}`;
    }

    constructor() {
        addIcons({ closeOutline, layersOutline, barcodeOutline, informationCircleOutline, trendingUpOutline, trendingDownOutline, removeOutline, checkmarkCircleOutline, sparklesOutline });
    }

    async escanearCodigo() {
        const codigo = await this.barcodeScanner.scan();
        if (!codigo) return;
        this.form.patchValue({ codigo_barras: codigo });
        this.ui.showToast(`Código capturado: ${codigo}`, 'success');
    }

    ngOnInit() {
        this.form = this.fb.group({
            nombre: [
                this.presentacionActual?.nombre ?? '',
                [Validators.required, Validators.minLength(2), Validators.maxLength(60), this.nombreDuplicadoValidator.bind(this)]
            ],
            factor_conversion: [
                this.presentacionActual?.factor_conversion ?? '',
                [Validators.required, Validators.min(2)]
            ],
            precio_costo: [
                this.presentacionActual?.precio_costo ?? '',
                [Validators.required, Validators.min(0.01)]
            ],
            precio_venta: [
                this.presentacionActual?.precio_venta ?? '',
                [Validators.required, Validators.min(0.01)]
            ],
            codigo_barras: [
                this.presentacionActual?.codigo_barras ?? ''
            ]
        });

        // En EDITAR: calcular margenPct inicial desde los valores cargados
        if (this.presentacionActual?.precio_venta) {
            this.margenPct = calcularMargenDesdePrecio(
                this.costoPack,
                this.presentacionActual.precio_venta
            );
        }
    }

    onCostoChange() {
        const costo = this.costoPack;
        if (costo <= 0) {
            this.form.get('precio_venta')?.setValue('', { emitEvent: false });
            this.margenPct = 20;
            return;
        }
        this.calcularPrecioConMargenDefault();
    }

    onFactorChange() {
        // Cambiar unidades no recalcula el precio — el costo del paquete es independiente
    }

    onPrecioVentaChange() {
        const venta = this.currencyService.parse(this.form.get('precio_venta')?.value ?? 0);
        const costo = this.costoPack;
        this.margenPct = calcularMargenDesdePrecio(costo, venta);
    }

    private calcularPrecioConMargenDefault() {
        const costo = this.costoPack;
        if (costo <= 0 || this.margenPct <= 0) return;
        const precio = calcularPrecioDesdeMargen(costo, this.margenPct);
        this.form.get('precio_venta')?.setValue(
            this.currencyService.format(precio),
            { emitEvent: false }
        );
    }

    private nombreDuplicadoValidator(control: AbstractControl): ValidationErrors | null {
        if (!control.value) return null;
        const nombre = control.value.trim().toUpperCase();
        const nombreActual = this.presentacionActual?.nombre?.toUpperCase();
        const duplicado = this.nombresExistentes.some(n => {
            const norm = n.toUpperCase();
            return norm === nombre && norm !== nombreActual;
        });
        return duplicado ? { nombreDuplicado: true } : null;
    }

    esCampoInvalido(campo: string): boolean {
        const c = this.form.get(campo);
        return !!(c && c.invalid && (c.dirty || c.touched));
    }

    cerrar() {
        this.modalCtrl.dismiss(null, 'cancel');
    }

    async confirmar() {
        this.form.markAllAsTouched();
        if (this.form.invalid || this.guardando) return;

        this.guardando = true;
        const v = this.form.value;

        const result: PresentacionModalResult = {
            nombre: v.nombre.trim().toUpperCase(),
            factor_conversion: Math.round(Number(v.factor_conversion)),
            precio_costo: this.currencyService.parse(v.precio_costo),
            precio_venta: this.currencyService.parse(v.precio_venta),
            codigo_barras: v.codigo_barras?.trim() || undefined
        };

        // Sin callback (modo CREAR en memoria): cerrar directamente
        if (!this.onConfirmar) {
            this.modalCtrl.dismiss(result, 'confirm');
            return;
        }

        // Con callback (modo EDITAR con BD): esperar resultado antes de cerrar
        try {
            const exito = await this.onConfirmar(result);
            if (exito) {
                this.modalCtrl.dismiss(result, 'confirm');
            }
        } finally {
            this.guardando = false;
        }
    }
}
