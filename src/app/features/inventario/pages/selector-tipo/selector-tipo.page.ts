import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    NavController,
    IonHeader, IonToolbar, IonButtons, IonButton, IonTitle, IonContent, IonIcon
} from '@ionic/angular/standalone';
import { ActivatedRoute } from '@angular/router';
import { addIcons } from 'ionicons';
import { arrowBackOutline, cubeOutline, colorPaletteOutline, chevronForwardOutline } from 'ionicons/icons';
import { ROUTES } from '../../../../core/config/routes.config';

@Component({
    selector: 'app-selector-tipo',
    templateUrl: './selector-tipo.page.html',
    styleUrls: ['./selector-tipo.page.scss'],
    standalone: true,
    imports: [CommonModule, IonHeader, IonToolbar, IonButtons, IonButton, IonTitle, IonContent, IonIcon]
})
export class SelectorTipoPage {
    private navCtrl = inject(NavController);
    private route = inject(ActivatedRoute);

    /** Codigo de barras escaneado desde inventario (si viene) */
    codigoBarras?: string;

    constructor() {
        addIcons({ arrowBackOutline, cubeOutline, colorPaletteOutline, chevronForwardOutline });
        this.codigoBarras = this.route.snapshot.queryParamMap.get('codigo') || undefined;
    }

    volver() {
        this.navCtrl.navigateBack(ROUTES.inventario.root);
    }

    irProductoSimple() {
        const extras = this.codigoBarras ? { queryParams: { codigo: this.codigoBarras } } : undefined;
        this.navCtrl.navigateForward(ROUTES.inventario.nuevoSimple, extras);
    }

    irProductoVariantes() {
        this.navCtrl.navigateForward(ROUTES.inventario.nuevoVariantes);
    }
}
