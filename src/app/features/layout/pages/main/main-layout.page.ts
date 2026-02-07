import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonMenu, IonContent, IonTabs, IonTabBar,
  IonTabButton, IonIcon, IonLabel, IonFabButton
} from '@ionic/angular/standalone';
import { SidebarComponent } from 'src/app/shared/components/sidebar/sidebar.component';
import { homeOutline, cartOutline, cubeOutline, barChartOutline, add, close, receiptOutline, clipboardOutline } from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';

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
   * Navega a la funcionalidad de gasto
   */
  irAGasto() {
    this.fabAbierto = false;
    this.router.navigate(['/home'], {
      queryParams: { action: 'gasto' }
    });
  }

  /**
   * Navega a la página de cuadre
   */
  irACuadre() {
    this.fabAbierto = false;
    this.router.navigate(['/home/cuadre-caja']);
  }
}
