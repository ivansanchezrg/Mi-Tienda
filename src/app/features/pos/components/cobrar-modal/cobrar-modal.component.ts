import { Component, Input, ViewChild, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
    IonContent, IonButton, IonIcon,
    ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    checkmarkOutline, closeOutline, arrowBackOutline,
    cashOutline, cardOutline, phonePortraitOutline, handRightOutline,
    alertCircleOutline
} from 'ionicons/icons';
import { CurrencyService } from '../../../../core/services/currency.service';

type MetodoPago = 'EFECTIVO' | 'DEUNA' | 'TRANSFERENCIA' | 'FIADO';
type Paso = 'metodo' | 'monto' | 'confirmar-fiado';

@Component({
    selector: 'app-cobrar-modal',
    templateUrl: './cobrar-modal.component.html',
    styleUrls: ['./cobrar-modal.component.scss'],
    standalone: true,
    imports: [CommonModule, FormsModule, IonContent, IonButton, IonIcon]
})
export class CobrarModalComponent {
    @Input() total!: number;
    @Input() subtotal!: number;
    @Input() descuento = 0;
    @Input() descuentoPct = 0;
    @Input() totalArticulos!: number;
    @Input() iniciarEnEfectivo = false;

    @ViewChild('montoInput') montoInputRef!: ElementRef<HTMLInputElement>;

    protected currencyService = inject(CurrencyService);
    private modalCtrl = inject(ModalController);

    paso: Paso = 'metodo';
    metodoSeleccionado: MetodoPago | null = null;
    montoRecibido: string = '';

    ngOnInit() {
        if (this.iniciarEnEfectivo) {
            this.metodoSeleccionado = 'EFECTIVO';
            this.paso = 'monto';
        }
    }

    ngAfterViewInit() {
        if (this.paso === 'monto') {
            this.focusInput();
        }
    }

    private focusInput() {
        setTimeout(() => this.montoInputRef?.nativeElement?.focus(), 300);
    }

    constructor() {
        addIcons({
            checkmarkOutline, closeOutline, arrowBackOutline,
            cashOutline, cardOutline, phonePortraitOutline, handRightOutline,
            alertCircleOutline
        });
    }

    // ── Getters para vuelto ──────────────────────
    get recibido(): number {
        return parseFloat(this.montoRecibido) || 0;
    }

    get vuelto(): number {
        const v = this.recibido - this.total;
        return v > 0 ? v : 0;
    }

    get montoValido(): boolean {
        return this.montoRecibido === '' || this.recibido >= this.total;
    }

    // ── Paso 1: selección de método ──────────────
    /** Total real para FIADO (sin descuento — no se aplica a ventas fiadas) */
    get totalFiado(): number {
        return this.subtotal;
    }

    seleccionarMetodo(metodo: MetodoPago) {
        this.metodoSeleccionado = metodo;
    }

    confirmarMetodo() {
        if (!this.metodoSeleccionado) return;
        const metodo = this.metodoSeleccionado;

        if (metodo === 'EFECTIVO') {
            this.paso = 'monto';
            setTimeout(() => this.focusInput(), 50);
        } else if (metodo === 'FIADO' && this.descuento > 0) {
            this.paso = 'confirmar-fiado';
        } else {
            this.modalCtrl.dismiss({ metodoPago: metodo, confirmado: true });
        }
    }

    confirmarFiado() {
        this.modalCtrl.dismiss({ metodoPago: 'FIADO', confirmado: true });
    }

    // ── Paso 2: confirmar efectivo ───────────────
    volverAMetodos() {
        this.paso = 'metodo';
        this.metodoSeleccionado = null;
        this.montoRecibido = '';
    }

    confirmarEfectivo() {
        if (!this.montoValido) return;
        this.modalCtrl.dismiss({ metodoPago: 'EFECTIVO', confirmado: true });
    }

    cancelar() {
        this.modalCtrl.dismiss(null);
    }
}
