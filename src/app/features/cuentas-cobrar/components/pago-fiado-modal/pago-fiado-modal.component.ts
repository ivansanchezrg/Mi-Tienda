import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonFooter,
    ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    closeOutline, cashOutline, cardOutline,
    phonePortraitOutline, checkmarkCircleOutline, ellipseOutline,
    chevronForwardOutline, checkmarkOutline, createOutline
} from 'ionicons/icons';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';
import { CuentasCobrarService } from '../../services/cuentas-cobrar.service';
import { VentaFiada } from '../../models/cuenta-cobrar.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { CurrencyInputDirective } from '../../../../shared/directives/currency-input.directive';

export interface DistribucionItem {
    venta: VentaFiada;
    pago: number;
    completa: boolean;
}

@Component({
    selector: 'app-pago-fiado-modal',
    templateUrl: './pago-fiado-modal.component.html',
    styleUrls: ['./pago-fiado-modal.component.scss'],
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
        IonContent, IonIcon, IonFooter,
        CurrencyInputDirective
    ]
})
export class PagoFiadoModalComponent implements OnInit {

    private modalCtrl = inject(ModalController);
    private fb = inject(FormBuilder);
    private cuentasService = inject(CuentasCobrarService);
    public currencyService = inject(CurrencyService);
    private ui = inject(UiService);

    @Input() ventas: VentaFiada[] = [];
    @Input() clienteNombre = '';

    form!: FormGroup;
    metodoPagoLabel = 'Efectivo';
    metodoPagoSeleccionado = 'EFECTIVO';
    guardando = false;
    progreso = 0;

    /** false = cobro total (default), true = abono parcial con input editable */
    modoAbono = false;

    get totalDeuda(): number {
        return this.ventas.reduce((s, v) => s + v.saldo_pendiente, 0);
    }

    /** Monto efectivo a cobrar: total si no es abono, o lo que diga el input */
    get montoACobrar(): number {
        if (!this.modoAbono) return this.totalDeuda;
        return Math.max(0, Number(this.form?.get('monto')?.value) || 0);
    }

    /** Distribución FIFO — solo se calcula cuando es abono parcial y hay >1 venta */
    get distribucion(): DistribucionItem[] {
        let resto = this.montoACobrar;
        return this.ventas.map(v => {
            const pago = parseFloat(Math.min(resto, v.saldo_pendiente).toFixed(2));
            resto = parseFloat(Math.max(0, resto - pago).toFixed(2));
            return { venta: v, pago, completa: pago >= v.saldo_pendiente };
        });
    }

    get mostrarDistribucion(): boolean {
        return this.modoAbono && this.ventas.length > 1 && this.montoACobrar > 0;
    }

    get botonTexto(): string {
        if (this.guardando) return 'Registrando...';
        if (!this.modoAbono) return `Cobrar $${this.currencyService.format(this.totalDeuda)}`;
        const monto = this.montoACobrar;
        if (monto <= 0) return 'Ingresar monto';
        if (monto >= this.totalDeuda) return `Cobrar todo $${this.currencyService.format(this.totalDeuda)}`;
        return `Abonar $${this.currencyService.format(monto)}`;
    }

    get formValido(): boolean {
        if (!this.modoAbono) return true;
        return this.form?.valid ?? false;
    }

    constructor() {
        addIcons({
            closeOutline, cashOutline, cardOutline,
            phonePortraitOutline, checkmarkCircleOutline, ellipseOutline,
            chevronForwardOutline, checkmarkOutline, createOutline
        });
    }

    ngOnInit() {
        this.form = this.fb.group({
            monto: [null, [Validators.required, Validators.min(0.01), Validators.max(this.totalDeuda)]],
            observaciones: ['']
        });
    }

    cerrar() {
        this.modalCtrl.dismiss();
    }

    /** Activa modo abono parcial */
    activarAbono() {
        this.modoAbono = true;
    }

    /** Vuelve a cobro total */
    volverCobroTotal() {
        this.modoAbono = false;
        this.form.patchValue({ monto: null });
    }

    async seleccionarMetodoPago() {
        const groups: ModalOptionGroup[] = [{
            options: [
                { label: 'Efectivo', icon: 'cash-outline', value: 'EFECTIVO' },
                { label: 'Transferencia', icon: 'phone-portrait-outline', value: 'TRANSFERENCIA' },
                { label: 'Tarjeta / DeUna', icon: 'card-outline', value: 'DEUNA' },
            ]
        }];

        const modal = await this.modalCtrl.create({
            component: OptionsModalComponent,
            componentProps: { title: 'Método de pago', groups, selectedValue: this.metodoPagoSeleccionado },
            cssClass: 'options-modal',
            breakpoints: [0, 1],
            initialBreakpoint: 1
        });

        await modal.present();
        const { data } = await modal.onDidDismiss();
        if (data) {
            this.metodoPagoSeleccionado = data;
            this.metodoPagoLabel = this.getLabelMetodo(data);
        }
    }

    async guardar() {
        if (!this.formValido || this.guardando) return;
        this.guardando = true;
        this.progreso = 0;

        const obs = this.form.value.observaciones || undefined;

        // En cobro total, el monto es totalDeuda → distribución cubre todo
        const items = this.distribucion.filter(d => d.pago > 0);

        try {
            for (const item of items) {
                const res = await this.cuentasService.registrarPago(
                    item.venta.id, item.pago, this.metodoPagoSeleccionado, obs,
                    true
                );
                if (!res.success) throw new Error('Fallo al registrar pago');
                this.progreso++;
            }

            const txt = !this.modoAbono
                ? 'Deuda cobrada completamente'
                : items.length === 1
                    ? 'Abono registrado correctamente'
                    : `${items.length} abonos registrados correctamente`;
            this.ui.showToast(txt, 'success');
            this.modalCtrl.dismiss({ pagado: true });

        } catch {
            this.ui.showToast('Error al registrar el pago', 'danger');
        } finally {
            this.guardando = false;
        }
    }

    labelComprobante(tipo: string): string {
        if (tipo === 'FACTURA') return 'Factura';
        if (tipo === 'NOTA_VENTA') return 'Nota de Venta';
        return 'Ticket';
    }

    private getLabelMetodo(metodo: string): string {
        if (metodo === 'TRANSFERENCIA') return 'Transferencia';
        if (metodo === 'DEUNA') return 'Tarjeta / DeUna';
        return 'Efectivo';
    }
}
