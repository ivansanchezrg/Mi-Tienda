import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonRefresher, IonRefresherContent,
  IonSkeletonText, IonIcon, NavController,
} from '@ionic/angular/standalone';
import { NgApexchartsModule } from 'ng-apexcharts';
import { addIcons } from 'ionicons';
import {
  printOutline, refreshOutline, cloudOfflineOutline, storefrontOutline,
  arrowUpOutline, arrowDownOutline, removeOutline, arrowBackOutline,
  trendingUpOutline, pricetagOutline, receiptOutline,
  peopleOutline, cubeOutline, walletOutline,
  alertCircleOutline, trendingDownOutline, warningOutline,
} from 'ionicons/icons';
import { GrupoService } from '../../services/grupo.service';
import {
  GrupoDashboard, GrupoDashboardNegocio, GrupoVentasSeries,
  GrupoAlerta, GrupoTopProductos,
} from '../../models/grupo.model';
import { UiService } from '@core/services/ui.service';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';
import {
  PeriodFilterComponent, PeriodOption,
} from '@shared/components/period-filter/period-filter.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

interface Variacion {
  pct: number;
  direccion: 'up' | 'down' | 'flat';
  label: string;
}

const VARIACION_FLAT: Variacion = { pct: 0, direccion: 'flat', label: '' };

/**
 * Página del dashboard "Resumen General" multi-negocio (plan MAX).
 * Ruta dedicada /resumen-general fuera del layout (sin tab bar/sidebar) — vista
 * de análisis, no de operación. La flecha del header regresa al home (/caja).
 * Solo lectura: consolida las métricas de todos los negocios del propietario vía
 * funciones fn_grupo_* (SECURITY DEFINER, derivan el propietario del JWT).
 */
@Component({
  selector: 'app-resumen-general',
  templateUrl: './resumen-general.page.html',
  styleUrls: ['./resumen-general.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    NgApexchartsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonRefresher, IonRefresherContent,
    IonSkeletonText, IonIcon,
    AppCurrencyPipe,
    PeriodFilterComponent,
    EmptyStateComponent,
  ],
})
export class ResumenGeneralPage implements OnInit {
  private grupoService = inject(GrupoService);
  private ui = inject(UiService);
  private navCtrl = inject(NavController);

  dashboard: GrupoDashboard | null = null;
  alertas: GrupoAlerta[] = [];
  topProductos: GrupoTopProductos = { top_ingreso: [], top_rentables: [] };
  /** Tab activo del bloque de top productos. */
  tabTop: 'ingreso' | 'ganancia' = 'ingreso';
  loading = true;
  /** true mientras se recarga con datos previos en pantalla (cambio de filtro) — atenúa el contenido en vez de mostrar skeleton (evita el parpadeo). */
  refetching = false;
  /** true si la última carga falló (red/RPC) — muestra estado de error con reintento. */
  error = false;
  filtro: 'hoy' | 'semana' | 'mes' | 'anio' | 'todo' = 'todo';

  // Variaciones precalculadas tras cada carga — el template las lee como
  // propiedades (no métodos): evita recrear objetos en cada ciclo de change
  // detection (cada una se renderiza 4 veces por pasada).
  varMonto: Variacion = VARIACION_FLAT;
  varGanancia: Variacion = VARIACION_FLAT;
  varVentas: Variacion = VARIACION_FLAT;
  varNegocios: Record<string, Variacion> = {};

  donutChartOptions: any = null;
  lineChartOptions: any = null;
  private primeraVez = true;
  /** Token anti-carrera: si el usuario cambia de filtro rápido, la respuesta
   *  obsoleta (que llega después de una carga más nueva) se descarta. */
  private cargaId = 0;

  readonly periodos: PeriodOption[] = [
    { value: 'hoy',    label: 'Hoy' },
    { value: 'semana', label: 'Semana' },
    { value: 'mes',    label: 'Mes' },
    { value: 'anio',   label: 'Año' },
    { value: 'todo',   label: 'Todo' },
  ];

  /** Paleta compartida donut ↔ tabla ↔ gráfico de líneas. */
  readonly negocioColors = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444'];

  constructor() {
    addIcons({
      printOutline, refreshOutline, cloudOfflineOutline, storefrontOutline,
      arrowUpOutline, arrowDownOutline, removeOutline, arrowBackOutline,
      trendingUpOutline, pricetagOutline, receiptOutline,
      peopleOutline, cubeOutline, walletOutline,
      alertCircleOutline, trendingDownOutline, warningOutline,
    });
  }

  async ngOnInit() {
    await this.cargar();
  }

  /** Exportar/Imprimir — stub por ahora (funcionalidad futura). */
  imprimir() {
    this.ui.showToast('Exportar el resumen estará disponible próximamente', 'primary');
  }

  /**
   * Vuelve al home. Esta página vive fuera del layout (sin sidebar/tabs).
   *
   * Usa navCtrl.back() en vez de un ion-back-button con [defaultHref]: ese
   * patrón resuelve la ruta completa de /caja (authGuard + suscripcionGuard)
   * ANTES de iniciar la animación de retroceso, generando un delay visible.
   * back() hace un pop del stack de Ionic sin re-resolver la ruta destino —
   * mismo fix ya aplicado en suscripcion.page.ts.
   */
  volverAlHome() {
    this.navCtrl.back();
  }

  // ── Labels contextuales por período ─────────────────────────────────────────

  get mostrarComparativa(): boolean {
    return this.filtro !== 'todo';
  }

  get labelPeriodoAnterior(): string {
    if (this.filtro === 'hoy')    return 'vs. ayer';
    if (this.filtro === 'semana') return 'vs. semana anterior';
    if (this.filtro === 'mes')    return 'vs. mes anterior';
    if (this.filtro === 'anio')   return 'vs. año anterior';
    return '';
  }

  /** true cuando no hay ninguna venta en el período (empty state del dashboard). */
  get sinDatos(): boolean {
    return !!this.dashboard && this.dashboard.grupo.total_ventas === 0;
  }

  // ── Color por negocio (por posición en la tabla ordenada) ───────────────────

  colorNegocio(index: number): string {
    return this.negocioColors[index % this.negocioColors.length];
  }

  // ── Alertas accionables ─────────────────────────────────────────────────────

  get hayAlertas(): boolean {
    return this.alertas.length > 0;
  }

  /** Color Ionic del chip según el tipo de alerta. */
  colorAlerta(tipo: GrupoAlerta['tipo']): string {
    if (tipo === 'SIN_VENTAS') return 'medium';
    if (tipo === 'CAYENDO')    return 'danger';
    return 'warning'; // STOCK_BAJO
  }

  /** Mensaje legible de la alerta (el nombre del negocio va aparte, en negrita). */
  mensajeAlerta(a: GrupoAlerta): string {
    if (a.tipo === 'SIN_VENTAS') return 'sin ventas en el período';
    if (a.tipo === 'CAYENDO')    return `cayendo ${Math.round(Math.abs(a.valor))}% vs período anterior`;
    const n = Math.round(a.valor);
    return `${n} ${n === 1 ? 'producto' : 'productos'} con stock bajo`;
  }

  // ── Top productos ───────────────────────────────────────────────────────────

  get hayTopProductos(): boolean {
    return this.topProductos.top_ingreso.length > 0
        || this.topProductos.top_rentables.length > 0;
  }

  setTabTop(tab: 'ingreso' | 'ganancia') {
    this.tabTop = tab;
  }

  // ── Variaciones (mismo criterio que ventas-resumen) ─────────────────────────

  /** Precalcula todas las variaciones tras una carga exitosa (grupo + por negocio). */
  private calcularVariaciones(d: GrupoDashboard) {
    this.varMonto    = this.calcularVariacion(d.grupo.total_monto,    d.grupo.total_monto_anterior);
    this.varGanancia = this.calcularVariacion(d.grupo.ganancia_bruta, d.grupo.ganancia_anterior);
    this.varVentas   = this.calcularVariacion(d.grupo.total_ventas,   d.grupo.total_ventas_anterior);

    this.varNegocios = {};
    for (const n of d.negocios) {
      this.varNegocios[n.negocio_id] = this.variacionDeNegocio(n);
    }
  }

  /** Variación por negocio (ya viene calculada del backend como variacion_pct). */
  private variacionDeNegocio(n: GrupoDashboardNegocio): Variacion {
    if (n.variacion_pct === null) {
      return n.total_monto > 0
        ? { pct: 100, direccion: 'up', label: 'Nuevo' }
        : { pct: 0, direccion: 'flat', label: '—' };
    }
    const diff = n.variacion_pct;
    const pct = Math.round(Math.abs(diff));
    if (Math.abs(diff) < 1) return { pct: 0, direccion: 'flat', label: '0%' };
    return {
      pct,
      direccion: diff > 0 ? 'up' : 'down',
      label: (diff > 0 ? '+' : '−') + pct + '%',
    };
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
      label: (diff > 0 ? '+' : '−') + pct + '%',
    };
  }

  // ── Carga ───────────────────────────────────────────────────────────────────

  /** Refetches en vuelo — con taps rápidos entre filtros hay cargas solapadas;
   *  la atenuación solo se apaga cuando termina la ÚLTIMA (no la primera). */
  private refetchesEnCurso = 0;

  async cambiarFiltro(filtro: string) {
    this.filtro = filtro as typeof this.filtro;
    const habiaDatos = this.dashboard !== null;
    // Si ya hay un dashboard cargado, evita el skeleton completo (parpadeo) —
    // el contenido anterior queda visible atenuado mientras llega la data del
    // nuevo período. Solo la primera carga muestra skeleton (nada que mantener).
    if (habiaDatos) {
      this.refetchesEnCurso++;
      this.refetching = true;
    }
    try {
      await this.cargar(habiaDatos);
    } finally {
      if (habiaDatos) {
        this.refetchesEnCurso--;
        this.refetching = this.refetchesEnCurso > 0;
      }
    }
  }

  async handleRefresh(event: CustomEvent) {
    await this.cargar(true);
    (event.target as HTMLIonRefresherElement).complete();
  }

  async cargar(silencioso = false) {
    // Token anti-carrera: cambios de filtro rápidos disparan cargas paralelas;
    // solo la más reciente puede escribir estado (una respuesta lenta y obsoleta
    // no debe pisar los datos del filtro actual).
    const id = ++this.cargaId;
    if (!silencioso) this.loading = true;
    this.error = false;
    try {
      // Dashboard + serie + alertas + top productos en paralelo (1 round-trip).
      const [dashboard, series, alertas, topProductos] = await Promise.all([
        this.grupoService.obtenerDashboard(this.filtro),
        this.grupoService.obtenerSeries(this.filtro),
        this.grupoService.obtenerAlertas(this.filtro),
        this.grupoService.obtenerTopProductos(this.filtro),
      ]);
      if (id !== this.cargaId) return;  // respuesta obsoleta — la descarta
      // call() devuelve null en error de red/RPC (offline, timeout, RLS).
      if (dashboard === null) {
        this.error = true;
        return;
      }
      this.dashboard = dashboard;
      this.alertas = alertas;
      this.topProductos = topProductos;
      this.calcularVariaciones(dashboard);
      this.buildDonutChart(dashboard);
      this.buildLineChart(dashboard, series);
      this.primeraVez = false;
    } catch {
      if (id !== this.cargaId) return;
      // No toast de red — el estado de error en pantalla ya comunica (patrón offline).
      this.error = true;
    } finally {
      if (id === this.cargaId) this.loading = false;
    }
  }

  // ── Donut de participación por negocio ──────────────────────────────────────

  private buildDonutChart(d: GrupoDashboard) {
    const conVentas = d.negocios.filter(n => n.total_monto > 0);
    if (conVentas.length === 0) {
      this.donutChartOptions = null;
      return;
    }
    const series = conVentas.map(n => Number(n.total_monto));
    const labels = conVentas.map(n => n.nombre);
    // Color por posición en la tabla completa (misma que la tabla renderiza).
    const colors = conVentas.map(n =>
      this.colorNegocio(d.negocios.findIndex(x => x.negocio_id === n.negocio_id)),
    );

    this.donutChartOptions = {
      chart: {
        type: 'donut',
        height: 240,
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
                label: 'Grupo',
                fontSize: '11px',
                fontWeight: 600,
                color: '#94a3b8',
                formatter: (w: any) => {
                  const sum = w.globals.seriesTotals.reduce((a: number, b: number) => a + b, 0);
                  return '$' + sum.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                },
              },
              value: {
                show: true,
                fontSize: '18px',
                fontWeight: 700,
                formatter: (val: string) => '$' + Number(val).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
              },
            },
          },
        },
      },
      stroke: { width: 2, colors: ['transparent'] },
      tooltip: {
        y: { formatter: (val: number) => '$' + val.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
      },
      theme: { mode: 'light' },
    };
  }

  // ── Gráfico de líneas: evolución de ventas por negocio ──────────────────────

  /**
   * Una línea por negocio sobre la serie temporal día×negocio. Los colores se
   * alinean por posición del negocio en la tabla (misma que donut y dots), para
   * que la línea, la porción del donut y el punto de la tabla sean del mismo color.
   *
   * Se omite cuando hay ≤ 1 día en el rango (ej. filtro "Hoy"): una línea de un
   * solo punto no aporta — los KPIs y el donut ya cuentan esa foto.
   */
  private buildLineChart(d: GrupoDashboard, s: GrupoVentasSeries) {
    if (!s.dias || s.dias.length <= 1 || s.series.length === 0) {
      this.lineChartOptions = null;
      return;
    }

    const chartSeries = s.series.map(serie => ({
      name: serie.nombre,
      data: serie.valores.map(v => Number(v)),
    }));

    // Color por posición del negocio en la tabla (dashboard.negocios).
    const colors = s.series.map(serie =>
      this.colorNegocio(d.negocios.findIndex(n => n.negocio_id === serie.negocio_id)),
    );

    const etiquetas = s.dias.map(dia => this.etiquetaDia(dia));

    this.lineChartOptions = {
      chart: {
        type: 'line',
        height: 240,
        toolbar: { show: false },
        zoom: { enabled: false },
        animations: { enabled: this.primeraVez, speed: 600, animateGradually: { enabled: false } },
        background: 'transparent',
      },
      series: chartSeries,
      colors,
      stroke: { width: 2.5, curve: 'smooth' },
      markers: { size: 0, hover: { size: 4 } },
      dataLabels: { enabled: false },
      legend: { show: false },
      xaxis: {
        categories: etiquetas,
        labels: {
          style: { fontSize: '10px', colors: '#94a3b8' },
          rotate: 0,
          hideOverlappingLabels: true,
        },
        axisBorder: { show: false },
        axisTicks: { show: false },
        tickAmount: Math.min(etiquetas.length, 7),
      },
      yaxis: {
        labels: {
          style: { fontSize: '10px', colors: '#94a3b8' },
          formatter: (val: number) => '$' + Math.round(val).toLocaleString('es-EC'),
        },
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
        shared: true,
        intersect: false,
        x: { formatter: (_v: any, opts: any) => s.dias[opts?.dataPointIndex] ?? '' },
        y: { formatter: (val: number) => '$' + val.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
      },
      theme: { mode: 'light' },
    };
  }

  /** 'YYYY-MM-DD' → 'dd/MM' para el eje X del gráfico de líneas. */
  private etiquetaDia(dia: string): string {
    const partes = dia.split('-');
    if (partes.length !== 3) return dia;
    return `${partes[2]}/${partes[1]}`;
  }
}
