import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    IonContent, IonRefresher, IonRefresherContent,
    IonSkeletonText, IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    cashOutline, cardOutline, phonePortraitOutline, handRightOutline,
    documentOutline, documentTextOutline, receiptOutline,
    alertCircleOutline, storefrontOutline, chevronDownCircleOutline
} from 'ionicons/icons';
import { VentasService } from '../../services/ventas.service';
import { CuentasCobrarService } from '../../../cuentas-cobrar/services/cuentas-cobrar.service';
import { CuentasCobrarResumen } from '../../../cuentas-cobrar/models/cuenta-cobrar.model';
import { ReporteVentasDia } from '../../models/venta.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { getFechaLocal } from '../../../../core/utils/date.util';

@Component({
    selector: 'app-ventas-resumen',
    templateUrl: './ventas-resumen.page.html',
    styleUrls: ['./ventas-resumen.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        IonContent, IonRefresher, IonRefresherContent,
        IonSkeletonText, IonIcon
    ]
})
export class VentasResumenPage implements OnInit {
    private ventasService = inject(VentasService);
    private cuentasCobrarService = inject(CuentasCobrarService);
    public currencyService = inject(CurrencyService);
    private ui = inject(UiService);

    reporte: ReporteVentasDia | null = null;
    deuda: CuentasCobrarResumen | null = null;
    loading = true;

    get fechaLabel(): string {
        const [y, m, d] = getFechaLocal().split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('es-EC', {
            weekday: 'long', day: 'numeric', month: 'long'
        });
    }

    get ticketPromedio(): number {
        return this.reporte?.total_ventas ? this.reporte.total_monto / this.reporte.total_ventas : 0;
    }

    getPorcentaje(monto: number): string {
        if (!this.reporte?.total_monto) return '0';
        return ((monto / this.reporte.total_monto) * 100).toFixed(1);
    }

    labelMetodoPago(metodo: string): string {
        if (metodo === 'DEUNA') return 'Tarjeta / DeUna';
        if (metodo === 'TRANSFERENCIA') return 'Transferencia';
        if (metodo === 'FIADO') return 'Fiado';
        return 'Efectivo';
    }

    labelComprobante(tipo: string): string {
        if (tipo === 'FACTURA') return 'Factura';
        if (tipo === 'NOTA_VENTA') return 'Nota de Venta';
        return 'Ticket';
    }

    constructor() {
        addIcons({
            cashOutline, cardOutline, phonePortraitOutline, handRightOutline,
            documentOutline, documentTextOutline, receiptOutline,
            alertCircleOutline, storefrontOutline, chevronDownCircleOutline
        });
    }

    async ngOnInit() {
        await this.cargar();
    }

    async handleRefresh(event: CustomEvent) {
        await this.cargar(true);
        (event.target as HTMLIonRefresherElement).complete();
    }

    async cargar(silencioso = false) {
        if (!silencioso) this.loading = true;
        try {
            const [reporte, deuda] = await Promise.all([
                this.ventasService.obtenerReporteDia(getFechaLocal()),
                this.cuentasCobrarService.obtenerResumen(),
            ]);
            this.reporte = reporte;
            this.deuda = deuda;
        } catch {
            await this.ui.showError('Error al cargar el resumen');
        } finally {
            this.loading = false;
        }
    }
}
