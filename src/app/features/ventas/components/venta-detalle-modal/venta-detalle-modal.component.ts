import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Capacitor } from '@capacitor/core';
import {
    IonContent, IonIcon, IonSpinner,
    ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    closeOutline, receiptOutline, documentTextOutline, documentOutline,
    cashOutline, cardOutline, phonePortraitOutline, handRightOutline,
    personOutline, calendarOutline, printOutline, alertCircleOutline,
    banOutline, shareOutline, downloadOutline
} from 'ionicons/icons';
import { VentasService } from '../../services/ventas.service';
import { ShareVentaService } from '../../services/share-venta.service';
import { Venta } from '../../models/venta.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { AuthService } from '../../../auth/services/auth.service';
import { UiService } from '../../../../core/services/ui.service';
import { formatFechaHoraEC, formatHoraEC } from '../../../../core/utils/date.util';

@Component({
    selector: 'app-venta-detalle-modal',
    templateUrl: './venta-detalle-modal.component.html',
    styleUrls: ['./venta-detalle-modal.component.scss'],
    standalone: true,
    imports: [
        CommonModule,
        IonContent, IonIcon, IonSpinner
    ]
})
export class VentaDetalleModalComponent implements OnInit {
    @Input() ventaId!: string;

    private ventasService = inject(VentasService);
    private shareService  = inject(ShareVentaService);
    protected currencyService = inject(CurrencyService);
    private authService    = inject(AuthService);
    private modalCtrl = inject(ModalController);
    private ui = inject(UiService);

    venta: Venta | null = null;
    loading = true;
    nombreNegocio = 'Mi Tienda';
    compartiendo = false;

    readonly isNative = Capacitor.isNativePlatform();

    constructor() {
        addIcons({
            closeOutline, receiptOutline, documentTextOutline, documentOutline,
            cashOutline, cardOutline, phonePortraitOutline, handRightOutline,
            personOutline, calendarOutline, printOutline, alertCircleOutline,
            banOutline, shareOutline, downloadOutline
        });
    }

    async ngOnInit() {
        this.venta = await this.ventasService.obtenerVentaDetalle(this.ventaId);
        this.nombreNegocio = this.authService.usuarioActualValue?.negocio_nombre ?? 'Mi Tienda';
        this.loading = false;
    }

    cerrar() {
        this.modalCtrl.dismiss();
    }

    async compartir() {
        if (!this.venta || this.compartiendo) return;
        this.compartiendo = true;
        await this.ui.showLoading('Generando comprobante...');
        try {
            await this.shareService.compartirVenta(this.venta);
        } catch (err: any) {
            const msg = (err?.message ?? '').toLowerCase();
            if (msg.includes('cancel') || msg.includes('dismiss') || msg.includes('abort')) return;
            this.ui.showToast('No se pudo generar el comprobante', 'danger');
        } finally {
            await this.ui.hideLoading();
            this.compartiendo = false;
        }
    }

    // ── helpers template ──────────────────────────

    get esAnulada(): boolean {
        return this.venta?.estado === 'ANULADA';
    }

    /** Extrae el motivo del campo observaciones: "ANULADA: motivo aquí" → "motivo aquí" */
    get motivoAnulacion(): string | null {
        if (!this.esAnulada || !this.venta?.observaciones) return null;
        const match = this.venta.observaciones.match(/ANULADA:\s*(.+)/);
        return match ? match[1].trim() : null;
    }

    get esFactura(): boolean {
        return this.venta?.tipo_comprobante === 'FACTURA';
    }

    get esFiado(): boolean {
        return this.venta?.metodo_pago === 'FIADO';
    }

    get totalAbonado(): number {
        return this.venta?.total_abonado ?? 0;
    }

    get totalPendiente(): number {
        return (this.venta?.total ?? 0) - this.totalAbonado;
    }

    get estadoPago(): string {
        return this.venta?.estado_pago ?? 'NO_APLICA';
    }

    get tieneClienteReal(): boolean {
        return !!this.venta?.cliente_nombre &&
               this.venta.cliente_nombre !== 'Consumidor Final';
    }

    labelComprobante(tipo: string): string {
        if (tipo === 'FACTURA')    return 'Factura';
        if (tipo === 'NOTA_VENTA') return 'Nota de Venta';
        return 'Ticket';
    }

    iconComprobante(tipo: string): string {
        if (tipo === 'FACTURA')    return 'document-outline';
        if (tipo === 'NOTA_VENTA') return 'document-text-outline';
        return 'receipt-outline';
    }

    labelMetodoPago(metodo: string): string {
        if (metodo === 'DEUNA')         return 'Deuna';
        if (metodo === 'TRANSFERENCIA') return 'Transferencia';
        if (metodo === 'FIADO')         return 'Fiado';
        return 'Efectivo';
    }

    iconMetodoPago(metodo: string): string {
        if (metodo === 'DEUNA')         return 'card-outline';
        if (metodo === 'TRANSFERENCIA') return 'phone-portrait-outline';
        if (metodo === 'FIADO')         return 'hand-right-outline';
        return 'cash-outline';
    }

    formatFechaHora(iso: string): string {
        return formatFechaHoraEC(iso);
    }

    formatHora(iso: string): string {
        return formatHoraEC(iso);
    }
}
