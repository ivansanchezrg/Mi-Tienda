import { Component, Input } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { listOutline, barChartOutline } from 'ionicons/icons';
import { Router } from '@angular/router';

@Component({
    selector: 'app-ventas-tabs',
    templateUrl: './ventas-tabs.component.html',
    styleUrls: ['./ventas-tabs.component.scss'],
    standalone: true,
    imports: [IonIcon]
})
export class VentasTabsComponent {
    @Input() activeTab: 'lista' | 'resumen' = 'lista';

    constructor(private router: Router) {
        addIcons({ listOutline, barChartOutline });
    }

    navigateTo(tab: 'lista' | 'resumen') {
        if (tab === this.activeTab) return;
        const path = tab === 'lista' ? '/ventas' : '/ventas/resumen';
        this.router.navigate([path], { replaceUrl: true });
    }
}
