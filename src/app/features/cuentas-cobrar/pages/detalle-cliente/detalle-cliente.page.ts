import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
    IonContent, IonHeader, IonTitle, IonToolbar,
    IonButtons, IonBackButton, IonIcon,
    IonButton, IonFooter,
    IonSkeletonText, IonRefresher, IonRefresherContent,
    ModalController, AlertController,
    ViewWillEnter, ViewWillLeave
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    handRightOutline, cashOutline, receiptOutline,
    documentTextOutline, documentOutline,
    shareOutline, chevronDownCircleOutline,
    callOutline, personOutline, checkmarkCircleOutline,
    eyeOutline, closeOutline
} from 'ionicons/icons';
import { CuentasCobrarService } from '../../services/cuentas-cobrar.service';
import { VentaFiada, VentaFiadaItem } from '../../models/cuenta-cobrar.model';
import { ClientesService } from '../../../clientes/services/clientes.service';
import { Cliente } from '../../../clientes/models/cliente.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { formatFechaEC, formatHoraEC } from '../../../../core/utils/date.util';
import { PagoFiadoModalComponent } from '../../components/pago-fiado-modal/pago-fiado-modal.component';
import { VentaDetalleModalComponent } from '../../../ventas/components/venta-detalle-modal/venta-detalle-modal.component';
import { Capacitor } from '@capacitor/core';
import { ConfigService } from '../../../../core/services/config.service';
import { ShareEstadoCuentaService, ComprobantePagoItem } from '../../services/share-estado-cuenta.service';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';

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
        EmptyStateComponent
    ]
})
export class DetalleClientePage implements OnInit, ViewWillEnter, ViewWillLeave {

    private route = inject(ActivatedRoute);
    private cuentasService = inject(CuentasCobrarService);
    private clientesService = inject(ClientesService);
    public currencyService = inject(CurrencyService);
    private ui = inject(UiService);
    private modalCtrl = inject(ModalController);
    private shareService = inject(ShareEstadoCuentaService);
    private alertCtrl = inject(AlertController);
    private config = inject(ConfigService);

    cliente: Cliente | null = null;
    ventasFiadas: VentaFiada[] = [];
    itemsPorVenta = new Map<string, VentaFiadaItem[]>();
    loading = true;
    compartiendo = false;

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
            shareOutline, chevronDownCircleOutline,
            callOutline, personOutline, checkmarkCircleOutline,
            eyeOutline, closeOutline
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
            if (!cliente) {
                this.ui.showToast('Cliente no encontrado', 'danger');
                return;
            }
            this.cliente = cliente;
            this.ventasFiadas = ventas;

            // Cargar items de cada venta en paralelo — fallo parcial no rompe la página
            const itemsResultados = await Promise.all(
                ventas.map(v => this.cuentasService.obtenerItemsVenta(v.id).catch(() => []))
            );
            this.itemsPorVenta = new Map(
                ventas.map((v, i) => [v.id, itemsResultados[i]])
            );
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
                ventas: this.ventasFiadas,
                clienteNombre: this.cliente?.nombre ?? ''
            }
        });

        await modal.present();
        const { data } = await modal.onDidDismiss();
        if (data?.pagado) {
            await this.cargarDatos(true);
            await this.ofrecerCompartirComprobante(
                data.itemsComprobante,
                data.montoTotal,
                data.saldoRestante
            );
        }
    }

    private async ofrecerCompartirComprobante(
        items: ComprobantePagoItem[],
        montoTotal: number,
        saldoRestante: number
    ) {
        const groups: ModalOptionGroup[] = [{
            options: [
                { label: 'Compartir comprobante', icon: 'share-outline', value: 'compartir' },
                { label: 'Omitir', icon: 'close-outline', value: 'omitir' },
            ]
        }];

        const modal = await this.modalCtrl.create({
            component: OptionsModalComponent,
            componentProps: {
                title: 'Pago registrado',
                subtitle: `$${this.currencyService.format(montoTotal)} cobrados`,
                groups
            },
            cssClass: 'options-modal',
            breakpoints: [0, 1],
            initialBreakpoint: 1
        });

        await modal.present();
        const { data } = await modal.onDidDismiss();

        if (data === 'compartir') {
            await this.compartirComprobante(items, montoTotal, saldoRestante);
        }
    }

    private async compartirComprobante(
        items: ComprobantePagoItem[],
        montoTotal: number,
        saldoRestante: number
    ) {
        if (!this.cliente) return;

        // Web: enviar comprobante por WhatsApp (solo texto)
        if (!Capacitor.isNativePlatform()) {
            await this.compartirComprobanteWeb(items, montoTotal, saldoRestante);
            return;
        }

        this.compartiendo = true;
        await this.ui.showLoading('Generando comprobante...');
        try {
            await this.shareService.compartirComprobantePago(
                this.cliente, items, montoTotal, saldoRestante, this.ventasFiadas
            );
        } catch (err: any) {
            const msg = err?.message ?? '';
            if (msg === 'CLIPBOARD_FALLBACK') {
                this.ui.showToast('Imagen copiada al portapapeles', 'success');
                return;
            }
            if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('dismiss') || msg.toLowerCase().includes('abort')) return;
            this.ui.showToast('No se pudo generar el comprobante', 'danger');
        } finally {
            await this.ui.hideLoading();
            this.compartiendo = false;
        }
    }

    private async compartirComprobanteWeb(
        items: ComprobantePagoItem[],
        montoTotal: number,
        saldoRestante: number
    ) {
        if (!this.cliente) return;

        if (!this.cliente.telefono) {
            this.ui.showToast('El cliente no tiene teléfono registrado', 'warning');
            return;
        }

        const alert = await this.alertCtrl.create({
            header: 'Enviar por WhatsApp',
            message: 'Se enviará un resumen en texto. Para compartir el comprobante con imagen, usa la app en el celular.',
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                { text: 'Enviar resumen', role: 'confirm' }
            ]
        });
        await alert.present();
        const { role } = await alert.onDidDismiss();
        if (role !== 'confirm') return;

        const nombreNegocio = await this.config.getNombreNegocio();
        this.shareService.enviarComprobanteWhatsApp(
            this.cliente, items, montoTotal, saldoRestante, this.ventasFiadas, nombreNegocio
        );
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

        // Web: enviar resumen por WhatsApp (solo texto)
        if (!Capacitor.isNativePlatform()) {
            await this.compartirDeudaWeb();
            return;
        }

        this.compartiendo = true;
        await this.ui.showLoading('Generando estado de cuenta...');
        try {
            await this.shareService.compartirEstadoCuenta(
                this.cliente,
                this.ventasFiadas,
                this.itemsPorVenta
            );
        } catch (err: any) {
            const msg = err?.message ?? '';
            if (msg === 'CLIPBOARD_FALLBACK') {
                this.ui.showToast('Imagen copiada al portapapeles', 'success');
                return;
            }
            if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('dismiss') || msg.toLowerCase().includes('abort')) return;
            this.ui.showToast('No se pudo generar el estado de cuenta', 'danger');
        } finally {
            await this.ui.hideLoading();
            this.compartiendo = false;
        }
    }

    private async compartirDeudaWeb() {
        if (!this.cliente) return;

        if (!this.cliente.telefono) {
            this.ui.showToast('El cliente no tiene teléfono registrado', 'warning');
            return;
        }

        const alert = await this.alertCtrl.create({
            header: 'Enviar por WhatsApp',
            message: 'Se enviará un resumen en texto. Para compartir el comprobante con imagen, usa la app en el celular.',
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                { text: 'Enviar resumen', role: 'confirm' }
            ]
        });
        await alert.present();
        const { role } = await alert.onDidDismiss();
        if (role !== 'confirm') return;

        const nombreNegocio = await this.config.getNombreNegocio();
        this.shareService.enviarResumenWhatsApp(this.cliente, this.ventasFiadas, nombreNegocio);
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
