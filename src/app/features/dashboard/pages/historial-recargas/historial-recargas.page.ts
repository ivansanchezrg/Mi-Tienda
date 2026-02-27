import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonMenuButton,
  IonContent, IonIcon, IonCard, IonSpinner,
  IonRefresher, IonRefresherContent
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  phonePortraitOutline, busOutline, listOutline,
  cloudDownloadOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { RecargasService, RecargaHistorial } from '../../services/recargas.service';
import { RecargasVirtualesService } from '@core/services/recargas-virtuales.service';

/**
 * Tipo unificado para el historial: engloba tanto cierres de turno
 * (de la tabla `recargas`) como recargas del proveedor (de `recargas_virtuales`).
 */
export interface HistorialItem {
  id: string | number;
  fecha: string;
  servicio: string;
  tipo: 'CIERRE' | 'CARGA_VIRTUAL';
  // Solo para CIERRE
  saldo_anterior?: number;
  saldo_actual?: number;
  venta_dia?: number;
  // Solo para CARGA_VIRTUAL
  monto_virtual?: number;
  pagado?: boolean;
  created_at: string;
}

interface GrupoHistorial {
  fecha: string;
  fechaDisplay: string;
  items: HistorialItem[];
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
    IonContent, IonIcon, IonCard, IonSpinner,
    IonRefresher, IonRefresherContent
  ]
})
export class HistorialRecargasPage implements OnInit {
  private ui = inject(UiService);
  private recargasService = inject(RecargasService);
  private recargasVirtualesService = inject(RecargasVirtualesService);

  loading = true;
  items: HistorialItem[] = [];
  itemsAgrupados: GrupoHistorial[] = [];

  // Filtros
  filtroActual: FiltroServicio = 'todas';
  filtros: FiltroOption[] = [
    { value: 'todas', label: 'Todas' },
    { value: 'celular', label: 'Celular' },
    { value: 'bus', label: 'Bus' }
  ];

  constructor() {
    addIcons({
      phonePortraitOutline,
      busOutline,
      listOutline,
      cloudDownloadOutline
    });
  }

  async ngOnInit() {
    await this.cargarHistorial();
  }

  ionViewWillEnter() {
    this.ui.hideTabs();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  async cargarHistorial() {
    this.loading = true;
    try {
      const [recargas, virtualesCelular, virtualesBus] = await Promise.all([
        this.recargasService.obtenerHistorialRecargas(),
        this.recargasVirtualesService.obtenerHistorial('CELULAR'),
        this.recargasVirtualesService.obtenerHistorial('BUS')
      ]);

      // Convertir cierres de turno → HistorialItem
      const itemsCierre: HistorialItem[] = recargas.map(r => ({
        id: r.id,
        fecha: r.fecha,
        servicio: r.servicio,
        tipo: 'CIERRE' as const,
        saldo_anterior: r.saldo_anterior,
        saldo_actual: r.saldo_actual,
        venta_dia: r.venta_dia,
        created_at: r.created_at
      }));

      // Convertir recargas del proveedor → HistorialItem
      const itemsVirtuales: HistorialItem[] = [...virtualesCelular, ...virtualesBus].map(rv => ({
        id: rv.id,
        fecha: rv.fecha,
        servicio: rv.servicio,
        tipo: 'CARGA_VIRTUAL' as const,
        monto_virtual: rv.monto_virtual,
        pagado: rv.pagado,
        created_at: rv.created_at
      }));

      // Combinar y ordenar por created_at descendente
      this.items = [...itemsCierre, ...itemsVirtuales]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      this.agruparPorFecha();
    } catch (error) {
      console.error('Error al cargar historial:', error);
      await this.ui.showError('Error al cargar el historial de recargas');
    } finally {
      this.loading = false;
    }
  }

  /**
   * Cambia el filtro y reagrupa
   */
  cambiarFiltro(filtro: FiltroServicio) {
    this.filtroActual = filtro;
    this.agruparPorFecha();
  }

  /**
   * Agrupa los items por fecha (aplicando filtro)
   */
  private agruparPorFecha() {
    const grupos = new Map<string, HistorialItem[]>();

    for (const item of this.filtrarItems()) {
      const fecha = item.fecha;
      if (!grupos.has(fecha)) {
        grupos.set(fecha, []);
      }
      grupos.get(fecha)!.push(item);
    }

    this.itemsAgrupados = Array.from(grupos.entries()).map(([fecha, items]) => ({
      fecha,
      fechaDisplay: this.formatearFechaGrupo(fecha),
      items
    }));
  }

  /**
   * Filtra los items según el filtro actual (aplica a ambos tipos)
   */
  private filtrarItems(): HistorialItem[] {
    if (this.filtroActual === 'todas') {
      return this.items;
    }
    const servicioFiltro = this.filtroActual.toUpperCase();
    return this.items.filter(i => i.servicio === servicioFiltro);
  }

  /**
   * Formatea la fecha del grupo (ej: "Hoy", "Ayer", "3 Feb")
   */
  private formatearFechaGrupo(fecha: string): string {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);

    const fechaItem = new Date(fecha + 'T00:00:00');
    fechaItem.setHours(0, 0, 0, 0);

    if (fechaItem.getTime() === hoy.getTime()) {
      return 'Hoy';
    } else if (fechaItem.getTime() === ayer.getTime()) {
      return 'Ayer';
    } else {
      const dia = fechaItem.getDate();
      const mes = fechaItem.toLocaleDateString('es-ES', { month: 'short' });
      const mesCapitalizado = mes.charAt(0).toUpperCase() + mes.slice(1);
      return `${dia} ${mesCapitalizado}`;
    }
  }

  async handleRefresh(event: any) {
    await this.cargarHistorial();
    event.target.complete();
  }

  getIconoServicio(servicio: string): string {
    return servicio === 'CELULAR' ? 'phone-portrait-outline' : 'bus-outline';
  }

  getColorServicio(servicio: string): string {
    return servicio === 'CELULAR' ? 'primary' : 'secondary';
  }

  formatearHora(created_at: string): string {
    const date = new Date(created_at);
    return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }
}
