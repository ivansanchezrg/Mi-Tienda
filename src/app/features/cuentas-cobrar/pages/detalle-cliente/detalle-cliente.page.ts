import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
    IonContent, IonHeader, IonTitle, IonToolbar,
    IonButtons, IonBackButton, IonIcon,
    IonButton, IonFooter,
    IonSkeletonText, IonRefresher, IonRefresherContent,
    ModalController,
    ViewWillEnter, ViewWillLeave
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    handRightOutline, cashOutline, receiptOutline,
    documentTextOutline, documentOutline,
    logoWhatsapp, shareOutline, chevronDownCircleOutline,
    callOutline, personOutline, checkmarkCircleOutline,
    eyeOutline
} from 'ionicons/icons';
import { CuentasCobrarService } from '../../services/cuentas-cobrar.service';
import { VentaFiada } from '../../models/cuenta-cobrar.model';
import { ClientesService } from '../../../clientes/services/clientes.service';
import { Cliente } from '../../../clientes/models/cliente.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { formatFechaEC, formatHoraEC } from '../../../../core/utils/date.util';
import { PagoFiadoModalComponent } from '../../components/pago-fiado-modal/pago-fiado-modal.component';
import { VentaDetalleModalComponent } from '../../../ventas/components/venta-detalle-modal/venta-detalle-modal.component';

@Component({
    selector: 'app-detalle-cliente-cuenta',
    templateUrl: './detalle-cliente.page.html',
    styleUrls: ['./detalle-cliente.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        IonContent, IonHeader, IonTitle, IonToolbar,
        IonButtons, IonBackButton, IonIcon,
        IonButton, IonFooter,
        IonSkeletonText, IonRefresher, IonRefresherContent,
    ]
})
export class DetalleClientePage implements OnInit, ViewWillEnter, ViewWillLeave {

    private route = inject(ActivatedRoute);
    private cuentasService = inject(CuentasCobrarService);
    private clientesService = inject(ClientesService);
    public currencyService = inject(CurrencyService);
    private ui = inject(UiService);
    private modalCtrl = inject(ModalController);

    cliente: Cliente | null = null;
    ventasFiadas: VentaFiada[] = [];
    loading = true;

    private clienteId = '';

    get totalDeuda(): number {
        return this.ventasFiadas.reduce((s, v) => s + v.saldo_pendiente, 0);
    }

    get totalPagado(): number {
        return this.ventasFiadas.reduce((s, v) => s + v.monto_pagado, 0);
    }

    constructor() {
        addIcons({
            handRightOutline, cashOutline, receiptOutline,
            documentTextOutline, documentOutline,
            logoWhatsapp, shareOutline, chevronDownCircleOutline,
            callOutline, personOutline, checkmarkCircleOutline,
            eyeOutline
        });
    }

    async ngOnInit() {
        this.clienteId = this.route.snapshot.paramMap.get('clienteId') ?? '';
        await this.cargarDatos();
    }

    ionViewWillEnter() {
        this.ui.hideTabs();
        if (this.cliente) this.cargarDatos(true);
    }

    ionViewWillLeave() {
        this.ui.showTabs();
    }

    async cargarDatos(silencioso = false) {
        if (!silencioso) this.loading = true;
        try {
            const [cliente, ventas] = await Promise.all([
                this.clientesService.obtenerClientePorId(this.clienteId),
                this.cuentasService.obtenerVentasFiadas(this.clienteId),
            ]);
            this.cliente = cliente;
            this.ventasFiadas = ventas;
        } catch {
            this.ui.showToast('Error al cargar datos del cliente', 'danger');
        } finally {
            this.loading = false;
        }
    }

    async handleRefresh(event: CustomEvent) {
        await this.cargarDatos(true);
        (event.target as HTMLIonRefresherElement).complete();
    }

    // ── Acciones ──

    async abonar() {
        if (this.ventasFiadas.length === 0) return;

        const modal = await this.modalCtrl.create({
            component: PagoFiadoModalComponent,
            componentProps: {
                ventas: this.ventasFiadas,       // ya ordenadas de más antiguo a más nuevo
                clienteNombre: this.cliente?.nombre ?? ''
            }
        });

        await modal.present();
        const { data } = await modal.onDidDismiss();
        if (data?.pagado) {
            await this.cargarDatos(true);
        }
    }

    async verDetalleVenta(ventaId: string, event: Event) {
        event.stopPropagation();
        const modal = await this.modalCtrl.create({
            component: VentaDetalleModalComponent,
            componentProps: { ventaId }
        });
        await modal.present();
    }

    async compartirDeuda() {
        if (!this.cliente || this.ventasFiadas.length === 0) return;

        const lineas = this.ventasFiadas.map(v => {
            const num = v.numero_comprobante ? `#${v.numero_comprobante}` : '';
            return `- ${this.formatFecha(v.fecha)} ${num}: $${this.currencyService.format(v.total)} (pendiente: $${this.currencyService.format(v.saldo_pendiente)})`;
        });

        const texto = [
            `*Detalle de cuenta - ${this.cliente.nombre}*`,
            '',
            ...lineas,
            '',
            `*Total pendiente: $${this.currencyService.format(this.totalDeuda)}*`,
        ].join('\n');

        if (navigator.share) {
            try { await navigator.share({ title: 'Cuenta por cobrar', text: texto }); }
            catch { /* usuario canceló */ }
        } else if (this.cliente.telefono) {
            this.enviarWhatsApp(texto);
        } else {
            await navigator.clipboard.writeText(texto);
            this.ui.showToast('Copiado al portapapeles', 'success');
        }
    }

    enviarWhatsApp(texto?: string) {
        if (!this.cliente?.telefono) {
            this.ui.showToast('El cliente no tiene teléfono registrado', 'warning');
            return;
        }
        const mensaje = texto ?? `Hola ${this.cliente.nombre}, tu saldo pendiente es de $${this.currencyService.format(this.totalDeuda)}`;
        const telefono = this.cliente.telefono.replace(/\D/g, '');
        const url = `https://wa.me/593${telefono.startsWith('0') ? telefono.slice(1) : telefono}?text=${encodeURIComponent(mensaje)}`;
        window.open(url, '_blank');
    }

    // ── Helpers template ──

    formatFecha(iso: string): string { return formatFechaEC(iso); }
    formatHora(iso: string): string { return formatHoraEC(iso); }

    labelComprobante(tipo: string): string {
        if (tipo === 'FACTURA') return 'Factura';
        if (tipo === 'NOTA_VENTA') return 'Nota de Venta';
        return 'Ticket';
    }

    iconComprobante(tipo: string): string {
        if (tipo === 'FACTURA') return 'document-outline';
        if (tipo === 'NOTA_VENTA') return 'document-text-outline';
        return 'receipt-outline';
    }
}
