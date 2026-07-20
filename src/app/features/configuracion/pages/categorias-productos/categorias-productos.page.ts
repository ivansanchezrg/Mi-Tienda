import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonIcon,
  IonRefresher, IonRefresherContent,
  IonFab, IonFabButton, IonSkeletonText,
  IonReorderGroup, IonReorder,
  ModalController, ItemReorderCustomEvent
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addOutline, chevronForwardOutline, pricetagOutline } from 'ionicons/icons';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { CategoriaProducto } from '../../../inventario/models/categoria-producto.model';
import { InventarioService } from '../../../inventario/services/inventario.service';
import { CategoriaProductoModalComponent } from '../../components/categoria-producto-modal/categoria-producto-modal.component';
import { UiService } from '@core/services/ui.service';

@Component({
  selector: 'app-categorias-productos',
  templateUrl: './categorias-productos.page.html',
  styleUrls: ['./categorias-productos.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonBackButton, IonIcon, IonSkeletonText,
    IonRefresher, IonRefresherContent,
    IonFab, IonFabButton,
    IonReorderGroup, IonReorder,
    EmptyStateComponent
  ]
})
export class CategoriasProductosPage implements OnInit {
  private inventarioService = inject(InventarioService);
  private modalCtrl         = inject(ModalController);
  private ui                = inject(UiService);

  categorias: CategoriaProducto[] = [];
  loading = false;
  private reordenando = false;

  constructor() {
    addIcons({ addOutline, chevronForwardOutline, pricetagOutline });
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

  async handleRefresh(event: CustomEvent) {
    await this.cargarCategorias(true);
    (event.target as HTMLIonRefresherElement).complete();
  }

  async cargarCategorias(silencioso = false) {
    if (!silencioso) this.loading = true;
    try {
      this.categorias = await this.inventarioService.obtenerCategorias();
    } catch {
      await this.ui.showError('Error al cargar las categorías. Verifica tu conexión.');
    } finally {
      this.loading = false;
    }
  }

  onItemClick(categoria: CategoriaProducto) {
    this.abrirModalEditar(categoria);
  }

  /**
   * complete() reacomoda el array en memoria y cierra la animación del gesto.
   * El guard `reordenando` evita que dos drags rápidos se pisen la persistencia;
   * el array en memoria ya queda con el orden final apenas termina el gesto.
   */
  async onReorder(event: ItemReorderCustomEvent) {
    this.categorias = event.detail.complete(this.categorias) as CategoriaProducto[];
    if (this.reordenando) return;
    this.reordenando = true;
    try {
      const ok = await this.inventarioService.reordenarCategorias(this.categorias.map(c => c.id));
      if (!ok) await this.cargarCategorias();
    } finally {
      this.reordenando = false;
    }
  }

  async abrirModalNueva() {
    const modal = await this.modalCtrl.create({
      component: CategoriaProductoModalComponent
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<{ nombre: string; activo: boolean }>();
    if (role === 'confirm' && data) {
      await this.ui.showLoading('Guardando...');
      try {
        await this.inventarioService.crearCategoria(data.nombre);
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

  private async abrirModalEditar(categoria: CategoriaProducto) {
    const modal = await this.modalCtrl.create({
      component: CategoriaProductoModalComponent,
      componentProps: { categoria }
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<{ nombre: string; activo: boolean }>();
    if (role === 'confirm' && data) {
      await this.ui.showLoading('Guardando...');
      try {
        if (data.nombre !== categoria.nombre) {
          await this.inventarioService.renombrarCategoria(categoria.id, data.nombre);
        }
        if (!data.activo && categoria.activo) {
          const { activos, inactivos } = await this.inventarioService.contarProductosPorCategoria(categoria.id);
          if (activos > 0) {
            this.ui.showToast(`No se puede desactivar: tiene ${activos} producto(s) activo(s)`, 'warning');
            return;
          }
          if (inactivos > 0) {
            this.ui.showToast(`No se puede desactivar: tiene ${inactivos} producto(s) desactivado(s) en esta categoría`, 'warning');
            return;
          }
          await this.inventarioService.desactivarCategoria(categoria.id);
        }
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
