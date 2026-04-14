import { Component, inject } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { listOutline, barChartOutline } from 'ionicons/icons';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

@Component({
    selector: 'app-ventas-tabs',
    templateUrl: './ventas-tabs.component.html',
    styleUrls: ['./ventas-tabs.component.scss'],
    standalone: true,
    imports: [IonIcon]
})
export class VentasTabsComponent {
    private router = inject(Router);

    activeTab: 'lista' | 'resumen' = 'lista';

    constructor() {
        addIcons({ listOutline, barChartOutline });

        // Detectar tab activa según la ruta actual
        this.syncTab(this.router.url);
        this.router.events
            .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
            .subscribe(e => this.syncTab(e.urlAfterRedirects));
    }

    navigateTo(tab: 'lista' | 'resumen') {
        if (tab === this.activeTab) return;
        const path = tab === 'lista' ? '/ventas' : '/ventas/resumen';
        this.router.navigate([path], { replaceUrl: true });
    }

    private syncTab(url: string) {
        this.activeTab = url.includes('/ventas/resumen') ? 'resumen' : 'lista';
    }
}
