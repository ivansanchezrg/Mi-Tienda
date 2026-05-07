import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
    IonContent, IonRefresher, IonRefresherContent,
    IonSkeletonText, IonIcon, IonDatetime, IonModal,
} from '@ionic/angular/standalone';
import { NgApexchartsModule } from 'ng-apexcharts';
import { addIcons } from 'ionicons';
import {
    cashOutline, cardOutline, phonePortraitOutline, handRightOutline,
    documentOutline, documentTextOutline, receiptOutline,
    alertCircleOutline, storefrontOutline, chevronDownCircleOutline,
    trendingUpOutline, pricetagOutline, closeCircleOutline,
    arrowUpOutline, arrowDownOutline, removeOutline,
    timeOutline, archiveOutline, walletOutline, cubeOutline,
    calendarOutline, closeOutline
} from 'ionicons/icons';
import { getFechaLocal } from '../../../../core/utils/date.util';
import { VentasService } from '../../services/ventas.service';
import { CuentasCobrarService } from '../../../clientes/services/cuentas-cobrar.service';
import { CuentasCobrarResumen } from '../../../clientes/models/cuenta-cobrar.model';
import { ReporteVentasDia } from '../../models/venta.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { VentasTabsComponent } from '../../components/ventas-tabs/ventas-tabs.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { PeriodOption } from '../../../../shared/components/period-filter/period-filter.component';

interface Variacion {
    pct: number;
    direccion: 'up' | 'down' | 'flat';
    label: string;
}

@Component({
    selector: 'app-ventas-resumen',
    templateUrl: './ventas-resumen.page.html',
    styleUrls: ['./ventas-resumen.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        NgApexchartsModule,
        IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
        IonContent, IonRefresher, IonRefresherContent,
        IonSkeletonText, IonIcon, IonDatetime, IonModal,
        VentasTabsComponent,
        EmptyStateComponent
    ]
})
export class VentasResumenPage implements OnInit {
    private ventasService = inject(VentasService);
    private cuentasCobrarService = inject(CuentasCobrarService);
    protected currencyService = inject(CurrencyService);
    private ui = inject(UiService);

    reporte: ReporteVentasDia | null = null;
    deuda: CuentasCobrarResumen | null = null;
    loading = true;
    filtro: 'hoy' | 'semana' | 'mes' | 'anio' | 'todo' = 'hoy';

    readonly periodos: PeriodOption[] = [
        { value: 'hoy',    label: 'Hoy' },
        { value: 'semana', label: 'Semana' },
        { value: 'mes',    label: 'Mes' },
        { value: 'anio',   label: 'Año' },
        { value: 'todo',   label: 'Todo' },
    ];

    donutChartOptions: any = null;
    horaChartOptions: any = null;
    private primeraVez = true;

    readonly barColors = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444'];
    readonly bajaRotColors = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e'];

    get tituloFiltro(): string {
        if (this.filtro === 'hoy') return 'hoy';
        if (this.filtro === 'semana') return 'esta semana';
        if (this.filtro === 'mes') return 'este mes';
        if (this.filtro === 'anio') return 'este año';
        return 'total histórico';
    }

    get labelPeriodoAnterior(): string {
        if (this.filtro === 'hoy') return 'vs. ayer';
        if (this.filtro === 'semana') return 'vs. semana anterior';
        if (this.filtro === 'mes') return 'vs. mes anterior';
        if (this.filtro === 'anio') return 'vs. año anterior';
        return '';
    }

    get mostrarComparativa(): boolean {
        return this.filtro !== 'todo';
    }

    get mostrarHoraPico(): boolean {
        return this.filtro === 'hoy' && (this.reporte?.ventas_por_hora?.length ?? 0) > 0;
    }

    get mostrarAnuladas(): boolean {
        if (!this.reporte || this.reporte.total_anuladas === 0) return false;
        const totalIntentos = this.reporte.total_ventas + this.reporte.total_anuladas;
        if (totalIntentos === 0) return false;
        return (this.reporte.total_anuladas / totalIntentos) >= 0.05;
    }

    get deudaPorcentaje(): number {
        if (!this.deuda?.total_deuda || !this.reporte?.total_monto) return 0;
        return Math.round((this.deuda.total_deuda / this.reporte.total_monto) * 100);
    }

    variacionMonto(): Variacion {
        if (!this.reporte) return { pct: 0, direccion: 'flat', label: '' };
        return this.calcularVariacion(this.reporte.total_monto, this.reporte.total_monto_anterior);
    }

    variacionGanancia(): Variacion {
        if (!this.reporte) return { pct: 0, direccion: 'flat', label: '' };
        return this.calcularVariacion(this.reporte.ganancia_bruta, this.reporte.ganancia_anterior);
    }

    variacionVentas(): Variacion {
        if (!this.reporte) return { pct: 0, direccion: 'flat', label: '' };
        return this.calcularVariacion(this.reporte.total_ventas, this.reporte.total_ventas_anterior);
    }

    private calcularVariacion(actual: number, anterior: number): Variacion {
        if (!anterior || anterior === 0) {
            if (actual > 0) return { pct: 100, direccion: 'up', label: 'Nuevo' };
            return { pct: 0, direccion: 'flat', label: '0%' };
        }
        const diff = ((actual - anterior) / anterior) * 100;
        const pct = Math.round(Math.abs(diff));
        if (Math.abs(diff) < 1) return { pct: 0, direccion: 'flat', label: '0%' };
        return {
            pct,
            direccion: diff > 0 ? 'up' : 'down',
            label: (diff > 0 ? '+' : '−') + pct + '%'
        };
    }

    horaFormat(hora: number): string {
        return hora.toString().padStart(2, '0') + 'h';
    }

    getPorcentaje(monto: number): number {
        if (!this.reporte?.total_monto) return 0;
        return Math.round((monto / this.reporte.total_monto) * 100);
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

    getBajaRotPct(unidades: number): number {
        if (!this.reporte?.productos_baja_rotacion?.length) return 0;
        const max = Math.max(...this.reporte.productos_baja_rotacion.map(p => p.total_unidades));
        if (max === 0) return 8;
        return Math.max(8, Math.round((unidades / max) * 100));
    }

    bajaRotColor(index: number): string {
        return this.bajaRotColors[index % this.bajaRotColors.length];
    }

    colorMetodo(metodo: string): string {
        if (metodo === 'EFECTIVO') return '#22c55e';
        if (metodo === 'DEUNA') return '#a855f7';
        if (metodo === 'TRANSFERENCIA') return '#3b82f6';
        return '#f59e0b';
    }

    // ── Año picker ────────────────────────────────────────────────────────────
    anioSeleccionado: number | null = null;
    anioPickerVisible = true;
    get hoy(): string { return getFechaLocal(); }
    get anioPickerValue(): string { return this.anioSeleccionado ? `${this.anioSeleccionado}-01-01` : this.hoy; }

    onAnioChange(event: CustomEvent) {
        const val = event.detail.value as string;
        if (!val) return;
        const anio = Number(val.split('-')[0]);
        if (!anio) return;
        this.anioSeleccionado = anio;
        this.filtro = 'anio';
        this.cargar();
    }

    limpiarAnio() {
        this.anioSeleccionado = null;
        this.filtro = 'hoy';
        // Recrear el picker para que vuelva al año actual
        this.anioPickerVisible = false;
        setTimeout(() => { this.anioPickerVisible = true; }, 0);
        this.cargar();
    }

    constructor() {
        addIcons({
            cashOutline, cardOutline, phonePortraitOutline, handRightOutline,
            documentOutline, documentTextOutline, receiptOutline,
            alertCircleOutline, storefrontOutline, chevronDownCircleOutline,
            trendingUpOutline, pricetagOutline, closeCircleOutline,
            arrowUpOutline, arrowDownOutline, removeOutline,
            timeOutline, archiveOutline, walletOutline, cubeOutline,
            calendarOutline, closeOutline
        });
    }

    async ngOnInit() {
        await this.cargar();
    }

    async handleRefresh(event: CustomEvent) {
        await this.cargar(true);
        (event.target as HTMLIonRefresherElement).complete();
    }

    async cambiarFiltro(filtro: string) {
        this.filtro = filtro as 'hoy' | 'semana' | 'mes' | 'anio' | 'todo';
        this.anioSeleccionado = null;
        await this.cargar();
    }

    async cargar(silencioso = false) {
        if (!silencioso) this.loading = true;
        try {
            const filtroEfectivo = (this.filtro === 'anio' && this.anioSeleccionado)
                ? `anio:${this.anioSeleccionado}`
                : this.filtro;
            const [reporte, deuda] = await Promise.all([
                this.ventasService.obtenerReportePeriodo(filtroEfectivo),
                this.cuentasCobrarService.obtenerResumen(),
            ]);
            this.reporte = reporte;
            this.deuda = deuda;
            if (reporte) {
                this.buildDonutChart(reporte);
                if (this.mostrarHoraPico) {
                    this.buildHoraChart(reporte);
                } else {
                    this.horaChartOptions = null;
                }
                this.primeraVez = false;
            }
        } catch {
            await this.ui.showError('Error al cargar el resumen');
        } finally {
            this.loading = false;
        }
    }

    private buildDonutChart(r: ReporteVentasDia) {
        const series = r.por_metodo_pago.map(m => Number(m.monto));
        const labels = r.por_metodo_pago.map(m => this.labelMetodoPago(m.metodo));
        const colors = r.por_metodo_pago.map(m => this.colorMetodo(m.metodo));
        this.donutChartOptions = {
            chart: {
                type: 'donut',
                height: 220,
                toolbar: { show: false },
                animations: { enabled: this.primeraVez, speed: 600, animateGradually: { enabled: false } },
                background: 'transparent',
            },
            series,
            labels,
            colors,
            legend: { show: false },
            dataLabels: { enabled: false },
            plotOptions: {
                pie: {
                    donut: {
                        size: '68%',
                        labels: {
                            show: true,
                            total: {
                                show: true,
                                label: 'Total',
                                fontSize: '11px',
                                fontWeight: 600,
                                color: '#94a3b8',
                                formatter: (w: any) => {
                                    const sum = w.globals.seriesTotals.reduce((a: number, b: number) => a + b, 0);
                                    return '$' + sum.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                                }
                            },
                            value: {
                                show: true,
                                fontSize: '18px',
                                fontWeight: 700,
                                formatter: (val: string) => '$' + Number(val).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            }
                        }
                    }
                }
            },
            stroke: { width: 2, colors: ['transparent'] },
            tooltip: {
                y: { formatter: (val: number) => '$' + val.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
            },
            theme: { mode: 'light' },
        };
    }

    private buildHoraChart(r: ReporteVentasDia) {
        // Reconstruir 24h fijos para que el gráfico sea uniforme y se vean los huecos
        const horas = Array.from({ length: 24 }, (_, i) => i);
        const dataMap = new Map(r.ventas_por_hora.map(v => [v.hora, v]));
        const cantidades = horas.map(h => dataMap.get(h)?.cantidad ?? 0);
        const montos = horas.map(h => dataMap.get(h)?.monto ?? 0);

        // Ventana visible: garantiza al menos 6 columnas para legibilidad
        const horasConVenta = r.ventas_por_hora.map(v => v.hora);
        let minHora = Math.max(0, Math.min(...horasConVenta) - 1);
        let maxHora = Math.min(23, Math.max(...horasConVenta) + 1);
        while ((maxHora - minHora + 1) < 6 && (minHora > 0 || maxHora < 23)) {
            if (minHora > 0) minHora--;
            if ((maxHora - minHora + 1) < 6 && maxHora < 23) maxHora++;
        }
        const ventana = horas.slice(minHora, maxHora + 1);
        const cantVentana = cantidades.slice(minHora, maxHora + 1);
        const montosVentana = montos.slice(minHora, maxHora + 1);

        this.horaChartOptions = {
            chart: {
                type: 'bar',
                height: 180,
                toolbar: { show: false },
                animations: { enabled: this.primeraVez, speed: 600, animateGradually: { enabled: false } },
                background: 'transparent',
                sparkline: { enabled: false },
            },
            series: [{ name: 'Ventas', data: cantVentana }],
            colors: ['#3b82f6'],
            plotOptions: {
                bar: {
                    borderRadius: 4,
                    columnWidth: '60%',
                    distributed: false,
                }
            },
            dataLabels: { enabled: false },
            xaxis: {
                categories: ventana.map(h => this.horaFormat(h)),
                labels: { style: { fontSize: '10px', colors: '#94a3b8' }, rotate: 0 },
                axisBorder: { show: false },
                axisTicks: { show: false },
                tickAmount: Math.min(ventana.length, 8),
            },
            yaxis: {
                labels: { show: false },
            },
            grid: {
                show: true,
                borderColor: '#e2e8f0',
                strokeDashArray: 3,
                xaxis: { lines: { show: false } },
                yaxis: { lines: { show: true } },
                padding: { top: 0, right: 8, bottom: 0, left: 8 },
            },
            tooltip: {
                custom: ({ dataPointIndex }: any) => {
                    const cant = cantVentana[dataPointIndex];
                    const monto = montosVentana[dataPointIndex];
                    const hora = ventana[dataPointIndex];
                    return `<div style="padding:8px 12px;font-size:12px;">
                        <strong>${this.horaFormat(hora)}</strong><br/>
                        ${cant} ${cant === 1 ? 'venta' : 'ventas'}<br/>
                        $${monto.toLocaleString('es-EC', { minimumFractionDigits: 2 })}
                    </div>`;
                }
            },
            legend: { show: false },
        };
    }

}
