import { Component, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonBadge } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { listOutline, barChartOutline, cloudUploadOutline } from 'ionicons/icons';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { OutboxService } from '@core/services/outbox.service';

@Component({
    selector: 'app-ventas-tabs',
    templateUrl: './ventas-tabs.component.html',
    styleUrls: ['./ventas-tabs.component.scss'],
    standalone: true,
    imports: [CommonModule, IonIcon, IonBadge]
})
export class VentasTabsComponent implements OnDestroy {
    private router = inject(Router);
    private outbox = inject(OutboxService);
    private routerSub!: Subscription;
    private pendientesSub!: Subscription;

    activeTab: 'lista' | 'resumen' | 'pendientes' = 'lista';
    pendientes = 0;

    constructor() {
        addIcons({ listOutline, barChartOutline, cloudUploadOutline });

        this.syncTab(this.router.url);
        this.routerSub = this.router.events
            .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
            .subscribe(e => this.syncTab(e.urlAfterRedirects));

        // La tab Pendientes solo aparece si hay ventas en cola.
        this.pendientesSub = this.outbox.pendientes$.subscribe(n => this.pendientes = n);
        void this.outbox.refrescarContador();
    }

    ngOnDestroy() {
        this.routerSub?.unsubscribe();
        this.pendientesSub?.unsubscribe();
    }

    navigateTo(tab: 'lista' | 'resumen' | 'pendientes') {
        if (tab === this.activeTab) return;
        const path = tab === 'lista' ? '/ventas'
                   : tab === 'resumen' ? '/ventas/resumen'
                   : '/ventas/pendientes';
        this.router.navigate([path], { replaceUrl: true });
    }

    private syncTab(url: string) {
        if (url.includes('/ventas/pendientes')) this.activeTab = 'pendientes';
        else if (url.includes('/ventas/resumen')) this.activeTab = 'resumen';
        else this.activeTab = 'lista';
    }
}
