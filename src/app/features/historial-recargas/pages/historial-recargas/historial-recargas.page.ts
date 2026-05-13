import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
  IonContent, IonIcon, IonCard,
  IonRefresher, IonRefresherContent, IonSkeletonText
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { phonePortraitOutline, busOutline, listOutline } from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { ConfigService } from '@core/services/config.service';
import { LoggerService } from '@core/services/logger.service';
import { RecargasService, RecargaHistorial } from '../../../caja/services/recargas.service';

interface GrupoHistorial {
  fecha: string;
  fechaDisplay: string;
  items: RecargaHistorial[];
}

type FiltroServicio = 'todas' | 'celular' | 'bus';

interface FiltroOption {
  value: FiltroServicio;
  label: string;
}

@Component({
  selector: 'app-historial-recargas',
  templateUrl: './historial-recargas.page.html',
  styleUrls: ['./historial-recargas.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
    IonContent, IonIcon, IonCard,
    IonRefresher, IonRefresherContent, IonSkeletonText
  ]
})
export class HistorialRecargasPage {
  private ui = inject(UiService);
  private configService = inject(ConfigService);
  private recargasService = inject(RecargasService);
  private logger = inject(LoggerService);

  loading = true;
  items: RecargaHistorial[] = [];
  itemsAgrupados: GrupoHistorial[] = [];

  recargasCelularHabilitada = false;
  recargasBusHabilitada = false;

  filtroActual: FiltroServicio = 'todas';
  filtros: FiltroOption[] = [];

  constructor() {
    addIcons({ phonePortraitOutline, busOutline, listOutline });
  }

  async ionViewWillEnter() {
    this.ui.hideTabs();
    const config = await this.configService.get();
    this.recargasCelularHabilitada = config?.recargas_celular_habilitada ?? false;
    this.recargasBusHabilitada     = config?.recargas_bus_habilitada ?? false;

    this.filtros = [
      { value: 'todas',   label: 'Todas' },
      { value: 'celular', label: 'Celular' },
      { value: 'bus',     label: 'Bus' },
    ];

    if (this.recargasCelularHabilitada && !this.recargasBusHabilitada) {
      this.filtroActual = 'celular';
    } else if (this.recargasBusHabilitada && !this.recargasCelularHabilitada) {
      this.filtroActual = 'bus';
    } else {
      this.filtroActual = 'todas';
    }

    await this.cargarHistorial();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  async cargarHistorial(silencioso = false) {
    if (!silencioso) this.loading = true;
    try {
      this.items = await this.recargasService.obtenerHistorialRecargas();
      this.agruparPorFecha();
    } catch (error) {
      this.logger.error('HistorialRecargasPage', 'Error al cargar historial', error);
      await this.ui.showError('Error al cargar el historial de recargas');
    } finally {
      this.loading = false;
    }
  }

  cambiarFiltro(filtro: FiltroServicio) {
    this.filtroActual = filtro;
    this.agruparPorFecha();
  }

  private agruparPorFecha() {
    const grupos = new Map<string, RecargaHistorial[]>();

    for (const item of this.filtrarItems()) {
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

  private filtrarItems(): RecargaHistorial[] {
    if (this.filtroActual === 'todas') return this.items;
    const codigo = this.filtroActual.toUpperCase();
    return this.items.filter(i => i.servicio === codigo);
  }

  private formatearFechaGrupo(fecha: string): string {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);

    const fechaItem = new Date(fecha + 'T00:00:00');
    fechaItem.setHours(0, 0, 0, 0);

    if (fechaItem.getTime() === hoy.getTime()) return 'Hoy';
    if (fechaItem.getTime() === ayer.getTime()) return 'Ayer';

    const dia = fechaItem.getDate();
    const mes = fechaItem.toLocaleDateString('es-ES', { month: 'short' });
    return `${dia} ${mes.charAt(0).toUpperCase() + mes.slice(1)}`;
  }

  async handleRefresh(event: CustomEvent) {
    await this.cargarHistorial(true);
    (event.target as HTMLIonRefresherElement).complete();
  }

  getIconoServicio(servicio: string): string {
    return servicio === 'CELULAR' ? 'phone-portrait-outline' : 'bus-outline';
  }

  labelCaja(servicio: string): string {
    return servicio === 'CELULAR' ? 'Caja Celular' : 'Caja Bus';
  }
}
