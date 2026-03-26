import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    IonContent, IonIcon, IonSpinner,
    ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    closeOutline, receiptOutline, documentTextOutline, documentOutline,
    cashOutline, cardOutline, phonePortraitOutline, handRightOutline,
    personOutline, calendarOutline, printOutline, alertCircleOutline,
    banOutline
} from 'ionicons/icons';
import { VentasService } from '../../services/ventas.service';
import { Venta } from '../../models/venta.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { ConfigService } from '../../../../core/services/config.service';
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
    public currencyService = inject(CurrencyService);
    private configService  = inject(ConfigService);
    private modalCtrl = inject(ModalController);

    venta: Venta | null = null;
    loading = true;
    nombreNegocio = 'Mi Tienda';

    constructor() {
        addIcons({
            closeOutline, receiptOutline, documentTextOutline, documentOutline,
            cashOutline, cardOutline, phonePortraitOutline, handRightOutline,
            personOutline, calendarOutline, printOutline, alertCircleOutline,
            banOutline
        });
    }

    async ngOnInit() {
        [this.venta, this.nombreNegocio] = await Promise.all([
            this.ventasService.obtenerVentaDetalle(this.ventaId),
            this.configService.getNombreNegocio(),
        ]);
        this.loading = false;
    }

    cerrar() {
        this.modalCtrl.dismiss();
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
        if (metodo === 'DEUNA')         return 'Tarjeta / DeUna';
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
