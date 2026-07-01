import { Component, ElementRef, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonSkeletonText, IonRefresher, IonRefresherContent,
  IonFab, IonFabButton, IonInfiniteScroll, IonInfiniteScrollContent,
  ModalController, NavController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chevronBackOutline, arrowUpOutline, timeOutline,
  checkmarkCircleOutline, alertCircleOutline, informationCircleOutline,
  personOutline
} from 'ionicons/icons';

import { ROUTES } from '@core/config/routes.config';
import { PAGINATION_CONFIG } from '@core/config/pagination.config';
import { UiService } from '@core/services/ui.service';
import { getFechaLocal, formatHoraEC } from '@core/utils/date.util';
import { PeriodFilterComponent, PeriodOption } from '@shared/components/period-filter/period-filter.component';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';

import { CierresTurnoService } from '../../services/cierres-turno.service';
import { CierreTurnoSnapshot } from '../../models/cierre-turno.model';
import { CierreTurnoDetalleModalComponent } from '../../components/cierre-turno-detalle-modal/cierre-turno-detalle-modal.component';

// Solo Hoy/Todo — la UI no expone semana/mes (ver `periodos`). Si en el futuro
// se agregan, ampliar este type y las ramas de calcularRango().
type FiltroFecha = 'hoy' | 'todas';

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
    IonFab, IonFabButton, IonInfiniteScroll, IonInfiniteScrollContent,
    PeriodFilterComponent,
    EmptyStateComponent,
  ]
})
export class HistorialTurnosPage {
  @ViewChild('content', { read: ElementRef }) private contentRef!: ElementRef;

  private router = inject(Router);
  private route  = inject(ActivatedRoute);
  private navCtrl = inject(NavController);
  private ui     = inject(UiService);
  private cierresService = inject(CierresTurnoService);
  private modalCtrl = inject(ModalController);

  cierres: CierreTurnoSnapshot[] = [];
  cierresAgrupados: CierresAgrupados[] = [];
  loading = false;
  filtro: FiltroFecha = 'todas';
  showScrollTop = false;

  page = 0;
  hasMore = false;

  // Solo Hoy/Todo — mismo criterio que Operaciones de Caja: no hay una
  // pregunta real de negocio que responda "esta semana" o "este mes" para
  // un historial de cierres; se entra a ver el turno actual o a auditar todo.
  readonly periodos: PeriodOption[] = [
    { value: 'todas',  label: 'Todo' },
    { value: 'hoy',    label: 'Hoy' },
  ];

  constructor() {
    addIcons({
      chevronBackOutline, arrowUpOutline, timeOutline,
      checkmarkCircleOutline, alertCircleOutline, informationCircleOutline,
      personOutline
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
    const from = this.route.snapshot.queryParamMap.get('from');
    if (from === 'home') {
      this.router.navigate([ROUTES.home], { replaceUrl: true });
    } else {
      this.navCtrl.back();
    }
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
    this.page = 0;
    try {
      const pagina = await this.fetchPagina(this.page);
      this.cierres = pagina;
      this.actualizarHasMore(pagina);
      this.agrupar();
    } catch {
      await this.ui.showToast('Error al cargar el historial', 'danger');
    } finally {
      this.loading = false;
    }
  }

  async cargarMas(event: CustomEvent) {
    this.page++;
    try {
      const pagina = await this.fetchPagina(this.page);
      this.cierres = [...this.cierres, ...pagina];
      this.actualizarHasMore(pagina);
      this.agrupar();
    } catch {
      await this.ui.showToast('Error al cargar más cierres', 'danger');
    } finally {
      (event.target as HTMLIonInfiniteScrollElement).complete();
    }
  }

  private fetchPagina(page: number): Promise<CierreTurnoSnapshot[]> {
    const { desde, hasta } = this.calcularRango();
    return this.cierresService.listar(desde, hasta, page);
  }

  private actualizarHasMore(pagina: CierreTurnoSnapshot[]) {
    this.hasMore = pagina.length === PAGINATION_CONFIG.historialTurnos.pageSize;
  }

  private calcularRango(): { desde: string; hasta: string } {
    const hoy = getFechaLocal();

    if (this.filtro === 'todas') {
      return { desde: '2000-01-01', hasta: hoy };
    }

    // 'hoy'
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
