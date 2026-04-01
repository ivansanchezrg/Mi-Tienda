import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonMenu, IonTabs, IonTabBar,
  IonTabButton, IonIcon, IonLabel, IonFabButton,
  IonSplitPane, ModalController
} from '@ionic/angular/standalone';
import { SidebarComponent } from 'src/app/shared/components/sidebar/sidebar.component';
import { homeOutline, cartOutline, cubeOutline, receiptOutline, add, close, clipboardOutline, barcodeOutline, readerOutline } from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { CuadreCajaPage } from 'src/app/features/dashboard/pages/cuadre-caja/cuadre-caja.page';
import { NuevaNotaModalComponent } from 'src/app/features/notas/components/nueva-nota-modal/nueva-nota-modal.component';
import { NotasService } from 'src/app/features/notas/services/notas.service';
import { AuthService } from 'src/app/features/auth/services/auth.service';

@Component({
  selector: 'app-main-layout',
  templateUrl: './main-layout.page.html',
  styleUrls: ['./main-layout.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonSplitPane, IonMenu, IonTabs, IonTabBar,
    IonTabButton, IonIcon, IonLabel, IonFabButton,
    SidebarComponent
  ]
})
export class MainLayoutPage {
  private ui = inject(UiService);
  private modalCtrl = inject(ModalController);
  private notasService = inject(NotasService);
  private authService = inject(AuthService);

  // Iconos importados como objetos (patrón Ionic Standalone)
  homeIcon = homeOutline;
  posIcon = barcodeOutline;
  ventasIcon = receiptOutline;
  inventarioIcon = cubeOutline;
  addIcon = add;
  closeIcon = close;
  clipboardIcon = clipboardOutline;
  readerIcon = readerOutline;

  // Estado del FAB
  fabAbierto = false;

  get showTabs() { return this.ui.tabsVisible(); }

  /**
   * Toggle del estado del FAB
   */
  toggleFab() {
    this.fabAbierto = !this.fabAbierto;
  }

  /**
   * Handler de acciones rápidas del sidebar (desktop)
   */
  async onAccionRapida(accion: 'nueva-nota' | 'cuadre') {
    if (accion === 'nueva-nota') {
      await this.nuevaNota();
    } else if (accion === 'cuadre') {
      await this.irACuadre();
    }
  }

  /**
   * Abre modal de cuadre de caja
   */
  async irACuadre() {
    this.fabAbierto = false;

    const modal = await this.modalCtrl.create({
      component: CuadreCajaPage,
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });
    await modal.present();
  }

  /**
   * Abre el modal de nueva nota directamente desde el FAB
   */
  async nuevaNota() {
    this.fabAbierto = false;
    const modal = await this.modalCtrl.create({
      component: NuevaNotaModalComponent,
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss<{ texto: string }>();
    if (role === 'confirm' && data?.texto) {
      const usuario = await this.authService.getUsuarioActual();
      if (usuario) {
        await this.notasService.crear(data.texto, usuario.id);
      }
    }
  }
}

