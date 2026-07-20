import { Component, inject } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { refreshOutline } from 'ionicons/icons';
import { FeedbackOverlayService, FeedbackOverlayTipo } from '../../../core/services/feedback-overlay.service';

/**
 * Overlay centrado, genérico y reutilizable para eventos "de ley" (ver doc de
 * FeedbackOverlayService). Montado UNA vez en AppComponent — nunca se declara por
 * página; se controla 100% a través de FeedbackOverlayService.mostrar()/success()/etc.
 *
 * 4 tipos con su propio ícono trazado (SVG animado, mismo patrón para los 4 — solo
 * cambia el path del glifo) y color: success (verde), error (rojo), warning (ámbar),
 * info (azul/primary).
 */
@Component({
    selector: 'app-feedback-overlay',
    templateUrl: './feedback-overlay.component.html',
    styleUrls: ['./feedback-overlay.component.scss'],
    standalone: true,
    imports: [IonIcon]
})
export class FeedbackOverlayComponent {
    protected feedback = inject(FeedbackOverlayService);

    constructor() {
        addIcons({ refreshOutline });
    }

    protected colorPorTipo(tipo: FeedbackOverlayTipo): string {
        switch (tipo) {
            case 'success': return 'success';
            case 'error':   return 'danger';
            case 'warning': return 'warning';
            case 'info':    return 'primary';
        }
    }
}
