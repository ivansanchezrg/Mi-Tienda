import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonMenu, IonContent, IonTabs, IonTabBar,
  IonTabButton, IonIcon, IonLabel
} from '@ionic/angular/standalone';
import { SidebarComponent } from 'src/app/shared/components/sidebar/sidebar.component';
import { homeOutline, cartOutline, cubeOutline, barChartOutline } from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';

@Component({
  selector: 'app-main-layout',
  templateUrl: './main-layout.page.html',
  styleUrls: ['./main-layout.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonMenu, IonContent, IonTabs, IonTabBar,
    IonTabButton, IonIcon, IonLabel,
    SidebarComponent
  ]
})
export class MainLayoutPage {
  private ui = inject(UiService);

  // Iconos importados como objetos (patrón Ionic Standalone)
  homeIcon = homeOutline;
  ventasIcon = cartOutline;
  inventarioIcon = cubeOutline;
  reportesIcon = barChartOutline;

  get showTabs() { return this.ui.tabsVisible(); }
}
