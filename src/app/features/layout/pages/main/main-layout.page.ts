import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonMenu, IonContent, IonTabs, IonTabBar,
  IonTabButton, IonIcon, IonLabel, IonFabButton,
  ModalController
} from '@ionic/angular/standalone';
import { SidebarComponent } from 'src/app/shared/components/sidebar/sidebar.component';
import { homeOutline, cartOutline, cubeOutline, receiptOutline, add, close, clipboardOutline, barcodeOutline } from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { CuadreCajaPage } from 'src/app/features/dashboard/pages/cuadre-caja/cuadre-caja.page';

@Component({
  selector: 'app-main-layout',
  templateUrl: './main-layout.page.html',
  styleUrls: ['./main-layout.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonMenu, IonContent, IonTabs, IonTabBar,
    IonTabButton, IonIcon, IonLabel, IonFabButton,
    SidebarComponent
  ]
})
export class MainLayoutPage {
  private ui = inject(UiService);
  private modalCtrl = inject(ModalController);

  // Iconos importados como objetos (patrón Ionic Standalone)
  homeIcon = homeOutline;
  posIcon = barcodeOutline;
  ventasIcon = receiptOutline;
  inventarioIcon = cubeOutline;
  addIcon = add;
  closeIcon = close;
  clipboardIcon = clipboardOutline;

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
   * Abre modal de cuadre de caja
   */
  async irACuadre() {
    this.fabAbierto = false;

    const modal = await this.modalCtrl.create({
      component: CuadreCajaPage
    });
    await modal.present();
  }
}

