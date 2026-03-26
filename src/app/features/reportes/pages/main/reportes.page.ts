import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    IonContent, IonHeader, IonTitle, IonToolbar,
    IonButtons, IonMenuButton, IonIcon,
    IonRefresher, IonRefresherContent,
    IonDatetime, IonModal,
    IonSkeletonText, IonBadge
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    calendarOutline, cashOutline, cardOutline,
    phonePortraitOutline, handRightOutline,
    receiptOutline, documentOutline, documentTextOutline,
    banOutline, chevronDownOutline, storefrontOutline
} from 'ionicons/icons';
import { ReportesService } from '../../services/reportes.service';
import { ReporteVentasDia } from '../../models/reporte.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { getFechaLocal } from '../../../../core/utils/date.util';

@Component({
    selector: 'app-reportes',
    templateUrl: './reportes.page.html',
    styleUrls: ['./reportes.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        IonContent, IonHeader, IonTitle, IonToolbar,
        IonButtons, IonMenuButton, IonIcon,
        IonRefresher, IonRefresherContent,
        IonDatetime, IonModal,
        IonSkeletonText, IonBadge
    ]
})
export class ReportesPage {
    private reportesService = inject(ReportesService);
    public currencyService = inject(CurrencyService);
    private ui = inject(UiService);

    fecha: string = getFechaLocal();
    reporte: ReporteVentasDia | null = null;
    loading = false;

    /** Máximo seleccionable en el picker */
    get hoy(): string { return getFechaLocal(); }

    get fechaLabel(): string {
        const [y, m, d] = this.fecha.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('es-EC', {
            day: 'numeric', month: 'short', year: 'numeric'
        });
    }

    constructor() {
        addIcons({
            calendarOutline, cashOutline, cardOutline,
            phonePortraitOutline, handRightOutline,
            receiptOutline, documentOutline, documentTextOutline,
            banOutline, chevronDownOutline, storefrontOutline
        });
    }

    ionViewWillEnter() {
        this.cargar();
    }

    async cargar(silencioso = false) {
        if (!silencioso) this.loading = true;
        try {
            this.reporte = await this.reportesService.obtenerReporteDia(this.fecha);
        } catch {
            await this.ui.showError('Error al cargar el reporte');
        } finally {
            this.loading = false;
        }
    }

    async handleRefresh(event: CustomEvent) {
        await this.cargar(true);
        (event.target as HTMLIonRefresherElement).complete();
    }

    onDateChange(event: CustomEvent) {
        const val = event.detail.value as string;
        if (val) {
            this.fecha = val.split('T')[0];
            this.cargar();
        }
    }

    // ── Helpers de iconos/labels (mismos que ventas.page) ──

    iconMetodoPago(metodo: string): string {
        if (metodo === 'DEUNA') return 'card-outline';
        if (metodo === 'TRANSFERENCIA') return 'phone-portrait-outline';
        if (metodo === 'FIADO') return 'hand-right-outline';
        return 'cash-outline';
    }

    labelMetodoPago(metodo: string): string {
        if (metodo === 'DEUNA') return 'Tarjeta';
        if (metodo === 'TRANSFERENCIA') return 'Transferencia';
        if (metodo === 'FIADO') return 'Fiado';
        return 'Efectivo';
    }

    iconComprobante(tipo: string): string {
        if (tipo === 'FACTURA') return 'document-outline';
        if (tipo === 'NOTA_VENTA') return 'document-text-outline';
        return 'receipt-outline';
    }

    labelComprobante(tipo: string): string {
        if (tipo === 'FACTURA') return 'Factura';
        if (tipo === 'NOTA_VENTA') return 'Nota Venta';
        return 'Ticket';
    }
}
