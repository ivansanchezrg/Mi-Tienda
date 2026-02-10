import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonMenu, IonContent, IonTabs, IonTabBar,
  IonTabButton, IonIcon, IonLabel, IonFabButton,
  ModalController
} from '@ionic/angular/standalone';
import { SidebarComponent } from 'src/app/shared/components/sidebar/sidebar.component';
import { homeOutline, cartOutline, cubeOutline, barChartOutline, add, close, receiptOutline, clipboardOutline } from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { GastoModalComponent } from 'src/app/features/dashboard/components/gasto-modal/gasto-modal.component';
import { GastosDiariosService } from 'src/app/features/dashboard/services/gastos-diarios.service';
import { GastoModalResult } from 'src/app/features/dashboard/models/gasto-diario.model';

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
  private router = inject(Router);
  private modalCtrl = inject(ModalController);
  private gastosService = inject(GastosDiariosService);

  // Iconos importados como objetos (patrón Ionic Standalone)
  homeIcon = homeOutline;
  ventasIcon = cartOutline;
  inventarioIcon = cubeOutline;
  reportesIcon = barChartOutline;
  addIcon = add;
  closeIcon = close;
  receiptIcon = receiptOutline;
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
   * Abre modal para registrar un gasto diario
   */
  async irAGasto() {
    this.fabAbierto = false;

    const modal = await this.modalCtrl.create({
      component: GastoModalComponent
    });

    await modal.present();
    const { data, role } = await modal.onDidDismiss<GastoModalResult>();

    if (role === 'confirm' && data) {
      const success = await this.gastosService.registrarGasto({
        categoria_gasto_id: data.categoria_gasto_id,
        monto: data.monto,
        observaciones: data.observaciones,
        fotoComprobante: data.fotoComprobante
      });

      // El servicio ya muestra el toast de éxito/error
    }
  }

  /**
   * Navega a la página de cuadre
   */
  irACuadre() {
    this.fabAbierto = false;
    this.router.navigate(['/home/cuadre-caja']);
  }
}
