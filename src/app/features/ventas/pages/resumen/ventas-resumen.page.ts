import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
    IonContent, IonRefresher, IonRefresherContent,
    IonSkeletonText, IonIcon,
    ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    cashOutline, cardOutline, phonePortraitOutline, handRightOutline,
    documentOutline, documentTextOutline, receiptOutline,
    alertCircleOutline, storefrontOutline, chevronDownCircleOutline,
    trophyOutline, trendingUpOutline,
    peopleOutline, chevronDownOutline
} from 'ionicons/icons';
import { VentasService } from '../../services/ventas.service';
import { AuthService } from '../../../auth/services/auth.service';
import { TurnosCajaService } from '../../../dashboard/services/turnos-caja.service';
import { RolUsuario } from '../../../auth/models/usuario_actual.model';
import { TurnoCajaConEmpleado } from '../../../dashboard/models/turno-caja.model';
import { CuentasCobrarService } from '../../../cuentas-cobrar/services/cuentas-cobrar.service';
import { CuentasCobrarResumen } from '../../../cuentas-cobrar/models/cuenta-cobrar.model';
import { ReporteVentasDia, ProductoMasVendido } from '../../models/venta.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { VentasTabsComponent } from '../../components/ventas-tabs/ventas-tabs.component';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';

@Component({
    selector: 'app-ventas-resumen',
    templateUrl: './ventas-resumen.page.html',
    styleUrls: ['./ventas-resumen.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
        IonContent, IonRefresher, IonRefresherContent,
        IonSkeletonText, IonIcon,
        VentasTabsComponent,
        EmptyStateComponent
    ]
})
export class VentasResumenPage implements OnInit {
    private ventasService = inject(VentasService);
    private authService = inject(AuthService);
    private turnosCajaService = inject(TurnosCajaService);
    private cuentasCobrarService = inject(CuentasCobrarService);
    private modalCtrl = inject(ModalController);
    public currencyService = inject(CurrencyService);
    private ui = inject(UiService);

    reporte: ReporteVentasDia | null = null;
    deuda: CuentasCobrarResumen | null = null;
    loading = true;
    filtro: 'hoy' | 'semana' | 'mes' | 'todo' = 'hoy';
    readonly filtros: ('hoy' | 'semana' | 'mes' | 'todo')[] = ['hoy', 'semana', 'mes', 'todo'];

    // Filtro por turno (solo ADMIN)
    rolUsuario: RolUsuario | null = null;
    turnosDelDia: TurnoCajaConEmpleado[] = [];
    turnoSeleccionado: TurnoCajaConEmpleado | null = null;

    get mostrarFiltroTurno(): boolean {
        return this.rolUsuario === 'ADMIN'
            && this.turnosDelDia.length > 1
            && this.filtro === 'hoy';
    }

    get labelTurno(): string {
        if (!this.turnoSeleccionado) return 'Todos los turnos';
        const t = this.turnoSeleccionado;
        const hora = this.formatHoraTurno(t.hora_fecha_apertura);
        const cierre = t.hora_fecha_cierre ? this.formatHoraTurno(t.hora_fecha_cierre) : 'en curso';
        return `Turno ${t.numero_turno} (${hora} - ${cierre}) — ${t.empleado?.nombre ?? ''}`;
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
            alertCircleOutline, storefrontOutline, chevronDownCircleOutline,
            trophyOutline, trendingUpOutline,
            peopleOutline, chevronDownOutline
        });
    }

    async ngOnInit() {
        const usuario = await this.authService.getUsuarioActual();
        this.rolUsuario = usuario?.rol ?? null;
        await Promise.all([
            this.cargar(),
            this.cargarTurnos()
        ]);
    }

    async handleRefresh(event: CustomEvent) {
        await this.cargar(true);
        (event.target as HTMLIonRefresherElement).complete();
    }

    async cambiarFiltro(filtro: 'hoy' | 'semana' | 'mes' | 'todo') {
        this.filtro = filtro;
        this.turnoSeleccionado = null;
        if (filtro === 'hoy') {
            this.cargarTurnos();
        } else {
            this.turnosDelDia = [];
        }
        await this.cargar();
    }

    async cargar(silencioso = false) {
        if (!silencioso) this.loading = true;
        try {
            const [reporte, deuda] = await Promise.all([
                this.ventasService.obtenerReportePeriodo(this.filtro, this.turnoSeleccionado?.id),
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

    private async cargarTurnos() {
        this.turnosDelDia = await this.turnosCajaService.obtenerTurnosDeFecha();
    }

    async abrirSelectorTurno() {
        const groups: ModalOptionGroup[] = [{
            options: [
                { label: 'Todos los turnos', value: 'todos' },
                ...this.turnosDelDia.map(t => {
                    const hora = this.formatHoraTurno(t.hora_fecha_apertura);
                    const cierre = t.hora_fecha_cierre ? this.formatHoraTurno(t.hora_fecha_cierre) : 'en curso';
                    return {
                        label: `Turno ${t.numero_turno} — ${t.empleado?.nombre ?? ''}`,
                        subtitle: `${hora} - ${cierre}`,
                        value: t.id
                    };
                })
            ]
        }];

        const modal = await this.modalCtrl.create({
            component: OptionsModalComponent,
            componentProps: {
                title: 'Filtrar por turno',
                groups,
                selectedValue: this.turnoSeleccionado?.id ?? 'todos'
            },
            cssClass: 'options-modal',
            breakpoints: [0, 1],
            initialBreakpoint: 1
        });
        await modal.present();

        const { data } = await modal.onDidDismiss();
        if (data !== undefined) {
            this.turnoSeleccionado = data === 'todos'
                ? null
                : this.turnosDelDia.find(t => t.id === data) ?? null;
            this.cargar();
        }
    }

    formatHoraTurno(iso: string): string {
        return new Date(iso).toLocaleTimeString('es-EC', {
            hour: '2-digit', minute: '2-digit', hour12: true
        });
    }
}
