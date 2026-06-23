import { Component, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { cardOutline, receiptOutline } from 'ionicons/icons';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { ROUTES } from '@core/config/routes.config';

/**
 * Tabs internas del área de Suscripción: "Mi Plan" (catálogo + plan vigente) e
 * "Historial" (pagos registrados). Patrón router-driven igual a VentasTabsComponent —
 * cada página aloja su propio ion-header con este componente, detecta la ruta activa
 * sola (NavigationEnd), sin depender de @Input().
 *
 * Solo se muestra en modo informativo (nunca en la pantalla de bloqueo "Suscríbete";
 * esa vive sin tabs porque no hay nada que navegar mientras la cuenta está bloqueada).
 */
@Component({
    selector: 'app-suscripcion-tabs',
    templateUrl: './suscripcion-tabs.component.html',
    styleUrls: ['./suscripcion-tabs.component.scss'],
    standalone: true,
    imports: [CommonModule, IonIcon]
})
export class SuscripcionTabsComponent implements OnDestroy {
    private router = inject(Router);
    private routerSub!: Subscription;

    activeTab: 'plan' | 'historial' = 'plan';

    constructor() {
        addIcons({ cardOutline, receiptOutline });

        this.syncTab(this.router.url);
        this.routerSub = this.router.events
            .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
            .subscribe(e => this.syncTab(e.urlAfterRedirects));
    }

    ngOnDestroy() {
        this.routerSub?.unsubscribe();
    }

    navigateTo(tab: 'plan' | 'historial') {
        if (tab === this.activeTab) return;
        const path = tab === 'plan' ? ROUTES.suscripcion.root : ROUTES.suscripcion.historial;
        this.router.navigate([path], { replaceUrl: true });
    }

    private syncTab(url: string) {
        this.activeTab = url.includes(ROUTES.suscripcion.historial) ? 'historial' : 'plan';
    }
}
