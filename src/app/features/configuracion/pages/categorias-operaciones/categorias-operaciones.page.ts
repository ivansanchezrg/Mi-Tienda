import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonIcon, IonSpinner, IonLabel,
  IonRefresher, IonRefresherContent,
  IonFab, IonFabButton,
  IonSegment, IonSegmentButton,
  ModalController, IonSkeletonText
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addOutline, lockClosedOutline, chevronForwardOutline } from 'ionicons/icons';
import { CategoriasOperacionesService } from '../../../dashboard/services/categorias-operaciones.service';
import { CategoriaOperacion, CategoriaOperacionInsert } from '../../../dashboard/models/categoria-operacion.model';
import { CategoriaOperacionModalComponent } from '../../components/categoria-operacion-modal/categoria-operacion-modal.component';
import { UiService } from '@core/services/ui.service';

@Component({
  selector: 'app-categorias-operaciones',
  templateUrl: './categorias-operaciones.page.html',
  styleUrls: ['./categorias-operaciones.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonBackButton, IonIcon, IonSkeletonText, IonLabel,
    IonRefresher, IonRefresherContent,
    IonFab, IonFabButton,
    IonSegment, IonSegmentButton
  ]
})
export class CategoriasOperacionesPage implements OnInit {
  private service = inject(CategoriasOperacionesService);
  private modalCtrl = inject(ModalController);
  private ui = inject(UiService);

  categorias: CategoriaOperacion[] = [];
  segmentoActual: 'EGRESO' | 'INGRESO' = 'EGRESO';
  loading = false;

  /** Categorías del segmento activo, ordenadas por código */
  get categoriasFiltradas(): CategoriaOperacion[] {
    return this.categorias.filter(c => c.tipo === this.segmentoActual);
  }

  constructor() {
    addIcons({ addOutline, lockClosedOutline, chevronForwardOutline });
  }

  ngOnInit() {
    this.cargarCategorias();
  }

  ionViewWillEnter() {
    this.ui.hideTabs();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  onSegmentChange(event: Event) {
    const val = (event as CustomEvent<{ value: string }>).detail.value;
    if (val === 'EGRESO' || val === 'INGRESO') {
      this.segmentoActual = val;
    }
  }

  contarTipo(tipo: string): number {
    return this.categorias.filter(c => c.tipo === tipo).length;
  }

  async handleRefresh(event: CustomEvent) {
    await this.cargarCategorias(true);
    (event.target as HTMLIonRefresherElement).complete();
  }

  async cargarCategorias(silencioso = false) {
    if (!silencioso) this.loading = true;
    try {
      this.categorias = await this.service.getCategorias();
    } catch {
      await this.ui.showError('Error al cargar las categorías. Verificá tu conexión.');
    } finally {
      this.loading = false;
    }
  }

  // ── Tap en item ─────────────────────────────────────────────────────────────

  onItemClick(categoria: CategoriaOperacion) {
    if (!categoria.seleccionable) return; // categorías del sistema: solo lectura
    this.abrirModalEditar(categoria);
  }

  // ── Modal creación ──────────────────────────────────────────────────────────

  async abrirModalNueva() {
    const modal = await this.modalCtrl.create({
      component: CategoriaOperacionModalComponent,
      componentProps: { tipoInicial: this.segmentoActual },
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<CategoriaOperacionInsert>();
    if (role === 'confirm' && data) {
      await this.ui.showLoading('Guardando...');
      try {
        await this.service.crear(data);
        await this.ui.showSuccess('Categoría creada');
        await this.cargarCategorias();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error al crear la categoría';
        await this.ui.showError(msg);
      } finally {
        await this.ui.hideLoading();
      }
    }
  }

  // ── Modal edición ───────────────────────────────────────────────────────────

  private async abrirModalEditar(categoria: CategoriaOperacion) {
    const modal = await this.modalCtrl.create({
      component: CategoriaOperacionModalComponent,
      componentProps: { categoria },
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<CategoriaOperacionInsert>();
    if (role === 'confirm' && data) {
      await this.ui.showLoading('Guardando...');
      try {
        await this.service.actualizar(categoria.id, data);
        await this.ui.showSuccess('Categoría actualizada');
        await this.cargarCategorias();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error al actualizar la categoría';
        await this.ui.showError(msg);
      } finally {
        await this.ui.hideLoading();
      }
    }
  }
}
