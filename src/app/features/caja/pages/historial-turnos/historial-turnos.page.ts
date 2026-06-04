import { Component, ElementRef, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonSkeletonText, IonRefresher, IonRefresherContent,
  IonFab, IonFabButton,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chevronBackOutline, arrowUpOutline, timeOutline,
  checkmarkCircleOutline, alertCircleOutline, informationCircleOutline,
  storefrontOutline, shieldCheckmarkOutline, phonePortraitOutline, busOutline,
  chevronForwardOutline, personOutline
} from 'ionicons/icons';

import { ROUTES } from '@core/config/routes.config';
import { UiService } from '@core/services/ui.service';
import { getFechaLocal, formatHoraEC } from '@core/utils/date.util';
import { PeriodFilterComponent, PeriodOption } from '@shared/components/period-filter/period-filter.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

import { CierresTurnoService } from '../../services/cierres-turno.service';
import { CierreTurnoSnapshot } from '../../models/cierre-turno.model';
import { CierreTurnoDetalleModalComponent } from '../../components/cierre-turno-detalle-modal/cierre-turno-detalle-modal.component';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';

type FiltroFecha = 'hoy' | 'semana' | 'mes' | 'todas';

interface CierresAgrupados {
  fecha: string;          // YYYY-MM-DD (clave de agrupación)
  fechaDisplay: string;   // "Hoy", "Ayer", "Vie 30 May"
  cierres: CierreTurnoSnapshot[];
}

@Component({
  selector: 'app-historial-turnos',
  templateUrl: './historial-turnos.page.html',
  styleUrls: ['./historial-turnos.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonSkeletonText, IonRefresher, IonRefresherContent,
    IonFab, IonFabButton,
    PeriodFilterComponent,
    EmptyStateComponent,
    AppCurrencyPipe,
  ]
})
export class HistorialTurnosPage {
  @ViewChild('content', { read: ElementRef }) private contentRef!: ElementRef;

  private router = inject(Router);
  private ui = inject(UiService);
  private cierresService = inject(CierresTurnoService);
  private modalCtrl = inject(ModalController);

  cierres: CierreTurnoSnapshot[] = [];
  cierresAgrupados: CierresAgrupados[] = [];
  loading = false;
  filtro: FiltroFecha = 'hoy';
  showScrollTop = false;

  readonly periodos: PeriodOption[] = [
    { value: 'hoy',    label: 'Hoy' },
    { value: 'semana', label: 'Semana' },
    { value: 'mes',    label: 'Mes' },
    { value: 'todas',  label: 'Todo' },
  ];

  constructor() {
    addIcons({
      chevronBackOutline, arrowUpOutline, timeOutline,
      checkmarkCircleOutline, alertCircleOutline, informationCircleOutline,
      storefrontOutline, shieldCheckmarkOutline, phonePortraitOutline, busOutline,
      chevronForwardOutline, personOutline
    });
  }

  async ionViewWillEnter() {
    this.ui.hideTabs();
    await this.cargar();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  volver() {
    this.router.navigate([ROUTES.caja.operacionesCaja], { replaceUrl: true });
  }

  async cambiarFiltro(filtro: string) {
    this.filtro = filtro as FiltroFecha;
    await this.cargar();
  }

  async handleRefresh(event: CustomEvent) {
    await this.cargar(true);
    (event.target as HTMLIonRefresherElement).complete();
  }

  onScroll(event: CustomEvent) {
    this.showScrollTop = (event.detail as any).scrollTop > 600;
  }

  scrollToTop() {
    this.contentRef?.nativeElement?.scrollToTop?.(400);
  }

  // ── Carga ─────────────────────────────────────────────────────────

  async cargar(silencioso = false) {
    if (!silencioso) this.loading = true;
    try {
      const { desde, hasta } = this.calcularRango();
      this.cierres = await this.cierresService.listar(desde, hasta);
      this.agrupar();
    } catch {
      await this.ui.showToast('Error al cargar el historial', 'danger');
    } finally {
      this.loading = false;
    }
  }

  private calcularRango(): { desde: string; hasta: string } {
    const hoy = getFechaLocal();

    if (this.filtro === 'semana') {
      const fecha = new Date(hoy + 'T00:00:00');
      const lunes = new Date(fecha);
      const diaSemana = fecha.getDay();
      lunes.setDate(fecha.getDate() - diaSemana + (diaSemana === 0 ? -6 : 1));
      const lunesLocal = `${lunes.getFullYear()}-${String(lunes.getMonth() + 1).padStart(2, '0')}-${String(lunes.getDate()).padStart(2, '0')}`;
      return { desde: lunesLocal, hasta: hoy };
    }

    if (this.filtro === 'mes') {
      return { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
    }

    if (this.filtro === 'todas') {
      return { desde: '2000-01-01', hasta: hoy };
    }

    return { desde: hoy, hasta: hoy };
  }

  // ── Agrupación por fecha local ────────────────────────────────────

  private agrupar() {
    const grupos = new Map<string, CierreTurnoSnapshot[]>();
    for (const c of this.cierres) {
      const fechaLocal = this.fechaLocalEC(c.hora_fecha_cierre);
      if (!grupos.has(fechaLocal)) grupos.set(fechaLocal, []);
      grupos.get(fechaLocal)!.push(c);
    }

    this.cierresAgrupados = Array.from(grupos.entries()).map(([fecha, cierres]) => ({
      fecha,
      fechaDisplay: this.formatearFechaGrupo(fecha),
      cierres,
    }));
  }

  private fechaLocalEC(iso: string): string {
    return new Date(iso).toLocaleDateString('en-CA', {
      timeZone: 'America/Guayaquil',
    });
  }

  private formatearFechaGrupo(fechaLocal: string): string {
    const hoy = getFechaLocal();
    if (fechaLocal === hoy) return 'Hoy';

    const ayer = new Date(hoy + 'T00:00:00');
    ayer.setDate(ayer.getDate() - 1);
    const ayerLocal = `${ayer.getFullYear()}-${String(ayer.getMonth() + 1).padStart(2, '0')}-${String(ayer.getDate()).padStart(2, '0')}`;
    if (fechaLocal === ayerLocal) return 'Ayer';

    return new Date(fechaLocal + 'T00:00:00').toLocaleDateString('es-EC', {
      weekday: 'short', day: 'numeric', month: 'short',
      timeZone: 'America/Guayaquil',
    });
  }

  // ── Estado del cuadre por cierre ──────────────────────────────────

  estadoCuadre(c: CierreTurnoSnapshot): 'ok' | 'sobrante' | 'faltante' {
    if (Math.abs(c.diferencia) <= 0.001) return 'ok';
    return c.diferencia > 0 ? 'sobrante' : 'faltante';
  }

  formatHora(iso: string): string {
    return formatHoraEC(iso);
  }

  // ── Abrir modal de detalle ────────────────────────────────────────

  async verDetalle(cierre: CierreTurnoSnapshot) {
    const modal = await this.modalCtrl.create({
      component: CierreTurnoDetalleModalComponent,
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      componentProps: { cierre }
    });
    await modal.present();
  }
}
