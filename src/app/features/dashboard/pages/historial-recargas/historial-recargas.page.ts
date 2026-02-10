import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonCard, IonSpinner,
  IonRefresher, IonRefresherContent
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chevronBackOutline, phonePortraitOutline, busOutline, listOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { RecargasService, RecargaHistorial } from '../../services/recargas.service';

interface GrupoRecargas {
  fecha: string;
  fechaDisplay: string;
  recargas: RecargaHistorial[];
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
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonCard, IonSpinner,
    IonRefresher, IonRefresherContent
  ]
})
export class HistorialRecargasPage implements OnInit {
  private router = inject(Router);
  private ui = inject(UiService);
  private recargasService = inject(RecargasService);

  loading = true;
  recargas: RecargaHistorial[] = [];
  recargasAgrupadas: GrupoRecargas[] = [];

  // Filtros
  filtroActual: FiltroServicio = 'todas';
  filtros: FiltroOption[] = [
    { value: 'todas', label: 'Todas' },
    { value: 'celular', label: 'Celular' },
    { value: 'bus', label: 'Bus' }
  ];

  constructor() {
    addIcons({
      chevronBackOutline,
      phonePortraitOutline,
      busOutline,
      listOutline
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
      this.recargas = await this.recargasService.obtenerHistorialRecargas();
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
   * Agrupa las recargas por fecha (aplicando filtro)
   */
  private agruparPorFecha() {
    const grupos = new Map<string, RecargaHistorial[]>();

    // Filtrar recargas según el filtro actual
    const recargasFiltradas = this.filtrarRecargas();

    for (const recarga of recargasFiltradas) {
      const fecha = recarga.fecha;
      if (!grupos.has(fecha)) {
        grupos.set(fecha, []);
      }
      grupos.get(fecha)!.push(recarga);
    }

    this.recargasAgrupadas = Array.from(grupos.entries()).map(([fecha, recargas]) => ({
      fecha,
      fechaDisplay: this.formatearFechaGrupo(fecha),
      recargas
    }));
  }

  /**
   * Filtra las recargas según el filtro actual
   */
  private filtrarRecargas(): RecargaHistorial[] {
    if (this.filtroActual === 'todas') {
      return this.recargas;
    }

    const servicioFiltro = this.filtroActual.toUpperCase();
    return this.recargas.filter(r => r.servicio === servicioFiltro);
  }

  /**
   * Formatea la fecha del grupo (ej: "Hoy", "Ayer", "3 Feb")
   */
  private formatearFechaGrupo(fecha: string): string {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);

    const fechaRecarga = new Date(fecha + 'T00:00:00');
    fechaRecarga.setHours(0, 0, 0, 0);

    if (fechaRecarga.getTime() === hoy.getTime()) {
      return 'Hoy';
    } else if (fechaRecarga.getTime() === ayer.getTime()) {
      return 'Ayer';
    } else {
      const dia = fechaRecarga.getDate();
      const mes = fechaRecarga.toLocaleDateString('es-ES', { month: 'short' });
      const mesCapitalizado = mes.charAt(0).toUpperCase() + mes.slice(1);
      return `${dia} ${mesCapitalizado}`;
    }
  }

  async handleRefresh(event: any) {
    await this.cargarHistorial();
    event.target.complete();
  }

  volver() {
    this.router.navigate(['/home']);
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
