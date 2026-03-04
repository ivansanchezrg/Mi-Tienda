import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonBackButton, IonIcon, IonSpinner,
  IonRefresher, IonRefresherContent,
  IonFab, IonFabButton,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addOutline, chevronForwardOutline } from 'ionicons/icons';
import { CategoriasGastosService } from '../../../dashboard/services/categorias-gastos.service';
import { CategoriaGasto, CategoriaGastoInsert } from '../../../gastos-diarios/models/gasto-diario.model';
import { CategoriaGastoModalComponent } from '../../components/categoria-gasto-modal/categoria-gasto-modal.component';
import { UiService } from '@core/services/ui.service';

@Component({
  selector: 'app-categorias-gastos',
  templateUrl: './categorias-gastos.page.html',
  styleUrls: ['./categorias-gastos.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonBackButton, IonIcon, IonSpinner,
    IonRefresher, IonRefresherContent,
    IonFab, IonFabButton
  ]
})
export class CategoriasGastosPage implements OnInit {
  private service   = inject(CategoriasGastosService);
  private modalCtrl = inject(ModalController);
  private ui        = inject(UiService);

  categorias: CategoriaGasto[] = [];
  loading = false;

  constructor() {
    addIcons({ addOutline, chevronForwardOutline });
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

  // ── Modal creación ──────────────────────────────────────────────────────────

  async abrirModalNueva() {
    const modal = await this.modalCtrl.create({
      component: CategoriaGastoModalComponent,
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<CategoriaGastoInsert>();
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

  async onItemClick(categoria: CategoriaGasto) {
    const modal = await this.modalCtrl.create({
      component: CategoriaGastoModalComponent,
      componentProps: { categoria },
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });
    await modal.present();

    const { data, role } = await modal.onDidDismiss<CategoriaGastoInsert>();
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
