import { Component, OnDestroy, inject } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { businessOutline, pricetagsOutline, settingsOutline } from 'ionicons/icons';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { ROUTES } from '@core/config/routes.config';
import { HorizontalScrollDirective } from '@shared/directives/horizontal-scroll.directive';

type AdminTab = 'negocios' | 'planes' | 'configuracion';

/**
 * Tabs internas del panel /admin (patrón chrome-tabs, igual que el módulo ventas).
 * Detecta la ruta activa con NavigationEnd — no con @Input(). Cada página del panel
 * incluye este componente en su header. Ver docs/PLAN-PLANES-SUSCRIPCION.md §4.7.
 */
@Component({
  selector: 'app-admin-tabs',
  templateUrl: './admin-tabs.component.html',
  styleUrls: ['./admin-tabs.component.scss'],
  standalone: true,
  imports: [IonIcon, HorizontalScrollDirective],
})
export class AdminTabsComponent implements OnDestroy {
  private router = inject(Router);
  private routerSub: Subscription;

  activeTab: AdminTab = 'negocios';

  constructor() {
    addIcons({ businessOutline, pricetagsOutline, settingsOutline });

    this.syncTab(this.router.url);
    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(e => this.syncTab(e.urlAfterRedirects));
  }

  ngOnDestroy() {
    this.routerSub?.unsubscribe();
  }

  navigateTo(tab: AdminTab) {
    if (tab === this.activeTab) return;
    const path =
      tab === 'negocios' ? ROUTES.admin.root
      : tab === 'planes' ? ROUTES.admin.planes
      :                    ROUTES.admin.configuracion;
    this.router.navigate([path], { replaceUrl: true });
  }

  private syncTab(url: string) {
    if (url.includes('/admin/planes')) this.activeTab = 'planes';
    else if (url.includes('/admin/configuracion')) this.activeTab = 'configuracion';
    else this.activeTab = 'negocios';

    // El componente se recrea en cada navegación (replaceUrl) — el scroll horizontal
    // arranca en 0 cada vez. Centrar el tab activo replica el patrón de POS (categorías).
    // Doble rAF (no setTimeout): garantiza que Angular/Ionic ya pintaron el layout
    // (ion-header/ion-toolbar con su ancho final) antes de medir y hacer scroll.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const tabEl = document.querySelector<HTMLElement>(`.chrome-tab[data-tab="${this.activeTab}"]`);
        tabEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      });
    });
  }
}
