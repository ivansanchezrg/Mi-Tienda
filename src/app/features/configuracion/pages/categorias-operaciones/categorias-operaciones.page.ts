import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonIcon, IonSpinner,
  IonRefresher, IonRefresherContent,
  IonFab, IonFabButton,
  ModalController, IonSkeletonText
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addOutline, lockClosedOutline, chevronForwardOutline } from 'ionicons/icons';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { CategoriasOperacionesService } from '../../../caja/services/categorias-operaciones.service';
import { CategoriaOperacion, CategoriaOperacionInsert } from '../../../caja/models/categoria-operacion.model';
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
    IonButtons, IonBackButton, IonIcon, IonSkeletonText,
    IonRefresher, IonRefresherContent,
    IonFab, IonFabButton,
    EmptyStateComponent
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

  async ngOnInit() {
    this.cargarCategorias();
  }

  ionViewWillEnter() {
    this.ui.hideTabs();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  setSegmento(tipo: 'EGRESO' | 'INGRESO') {
    this.segmentoActual = tipo;
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
      await this.ui.showError('Error al cargar las categorías. Verifica tu conexión.');
    } finally {
      this.loading = false;
    }
  }

  // ── Tap en item ─────────────────────────────────────────────────────────────

  onItemClick(categoria: CategoriaOperacion) {
    this.abrirModalEditar(categoria);
  }

  // ── Modal creación ──────────────────────────────────────────────────────────

  async abrirModalNueva() {
    const modal = await this.modalCtrl.create({
      component: CategoriaOperacionModalComponent,
      componentProps: { tipoInicial: this.segmentoActual }
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
      componentProps: { categoria }
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
    } else if (role === 'delete') {
      await this.ui.showLoading('Eliminando...');
      try {
        await this.service.eliminar(categoria.id);
        await this.ui.showSuccess('Categoría eliminada');
        await this.cargarCategorias();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error al eliminar la categoría';
        await this.ui.showError(msg);
      } finally {
        await this.ui.hideLoading();
      }
    }
  }
}
