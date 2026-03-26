import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import {
    IonHeader, IonToolbar, IonTitle,
    IonButtons, IonMenuButton
} from '@ionic/angular/standalone';
import { VentasTabsComponent } from '../../components/ventas-tabs/ventas-tabs.component';

@Component({
    selector: 'app-ventas-layout',
    templateUrl: './ventas-layout.page.html',
    standalone: true,
    imports: [
        RouterModule,
        IonHeader, IonToolbar, IonTitle,
        IonButtons, IonMenuButton,
        VentasTabsComponent
    ]
})
export class VentasLayoutPage {}
