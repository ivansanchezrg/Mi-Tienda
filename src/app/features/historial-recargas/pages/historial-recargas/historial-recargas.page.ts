import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
  IonContent, IonIcon, IonCard,
  IonRefresher, IonRefresherContent, IonSkeletonText,
  IonInfiniteScroll, IonInfiniteScrollContent,
  IonFab, IonFabButton
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { phonePortraitOutline, busOutline, listOutline } from 'ionicons/icons';
import { ConfigService } from '@core/services/config.service';
import { PAGINATION_CONFIG } from '@core/config/pagination.config';
import { PaginatedListPage } from '@shared/pages/paginated-list.page';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { PeriodFilterComponent, PeriodOption } from '@shared/components/period-filter/period-filter.component';
import { RecargasService, RecargaHistorial } from '../../../caja/services/recargas.service';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';

interface GrupoHistorial {
  fecha: string;
  fechaDisplay: string;
  items: RecargaHistorial[];
}

type FiltroServicio = 'todas' | 'celular' | 'bus';

@Component({
  selector: 'app-historial-recargas',
  templateUrl: './historial-recargas.page.html',
  styleUrls: ['./historial-recargas.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
    IonContent, IonIcon, IonCard,
    IonRefresher, IonRefresherContent, IonSkeletonText,
    IonInfiniteScroll, IonInfiniteScrollContent,
    IonFab, IonFabButton,
    EmptyStateComponent,
    PeriodFilterComponent,
    AppCurrencyPipe,
  ]
})
export class HistorialRecargasPage extends PaginatedListPage<RecargaHistorial> {
  private configService = inject(ConfigService);
  private recargasService = inject(RecargasService);

  protected readonly pageSize = PAGINATION_CONFIG.historialRecargas.pageSize;
  readonly loadingMoreText = 'Cargando más recargas...';

  itemsAgrupados: GrupoHistorial[] = [];

  recargasCelularHabilitada = false;
  recargasBusHabilitada = false;

  filtroActual: FiltroServicio = 'todas';
  filtros: PeriodOption[] = [
    { value: 'todas',   label: 'Todas' },
    { value: 'celular', label: 'Celular' },
    { value: 'bus',     label: 'Bus' },
  ];

  constructor() {
    super();
    addIcons({ phonePortraitOutline, busOutline, listOutline });
  }

  async ionViewWillEnter() {
    this.ui.hideTabs();
    // Skeleton desde el primer paint — sin esto, el await de config dejaría
    // una ventana con loading=false e items=[] donde parpadea el empty-state
    this.loading = true;
    const config = await this.configService.get();
    this.recargasCelularHabilitada = config?.recargas_celular_habilitada ?? false;
    this.recargasBusHabilitada     = config?.recargas_bus_habilitada ?? false;

    if (this.recargasCelularHabilitada && !this.recargasBusHabilitada) {
      this.filtroActual = 'celular';
    } else if (this.recargasBusHabilitada && !this.recargasCelularHabilitada) {
      this.filtroActual = 'bus';
    } else {
      this.filtroActual = 'todas';
    }

    await this.cargar();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  protected fetchPage(page: number): Promise<RecargaHistorial[]> {
    // Filtro server-side: con paginación, filtrar en cliente solo cubriría
    // las páginas ya cargadas y dejaría huecos en el listado.
    const servicio = this.filtroActual === 'todas'
      ? undefined
      : this.filtroActual.toUpperCase() as 'CELULAR' | 'BUS';
    return this.recargasService.obtenerHistorialRecargas(page, this.pageSize, servicio);
  }

  protected override async cargar(silencioso = false): Promise<void> {
    await super.cargar(silencioso);
    this.agruparPorFecha();
  }

  override async cargarMas(event: CustomEvent): Promise<void> {
    await super.cargarMas(event);
    this.agruparPorFecha();
  }

  async cambiarFiltro(filtro: string) {
    this.filtroActual = filtro as FiltroServicio;
    await this.cargar();
  }

  private agruparPorFecha() {
    const grupos = new Map<string, RecargaHistorial[]>();

    for (const item of this.items) {
      if (!grupos.has(item.fecha)) {
        grupos.set(item.fecha, []);
      }
      grupos.get(item.fecha)!.push(item);
    }

    this.itemsAgrupados = Array.from(grupos.entries()).map(([fecha, items]) => ({
      fecha,
      fechaDisplay: this.formatearFechaGrupo(fecha),
      items
    }));
  }

  private formatearFechaGrupo(fecha: string): string {
    return new Date(fecha + 'T00:00:00').toLocaleDateString('es', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
  }

  labelCaja(servicio: string): string {
    return servicio === 'CELULAR' ? 'Caja Celular' : 'Caja Bus';
  }
}
