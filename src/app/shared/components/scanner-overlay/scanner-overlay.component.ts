import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';

/**
 * Overlay del escáner de cámara — ÚNICA fuente del marco + línea animada + hint que
 * se muestra sobre la cámara nativa (body.scanner-active hace transparente el WebView).
 *
 * Se usa en dos modos:
 *  - **One-shot** (inventario, consulta de precio): con el botón ✕ (`showClose = true`,
 *    default). El caller espera `scanner.scan()` y cierra al leer un código.
 *  - **Continuo** (POS): `showClose = false` + contenido proyectado (`<ng-content>`) para
 *    el preview del producto escaneado y el badge del carrito, que reemplazan al ✕ como
 *    forma de cerrar. Así el marco/línea/animación NO se duplican en el POS.
 *
 * Requiere que `body.scanner-active` esté presente (lo pone BarcodeScannerService) para
 * que este overlay quede visible mientras el resto del WebView se oculta — ver global.scss.
 */
@Component({
    selector: 'app-scanner-overlay',
    templateUrl: './scanner-overlay.component.html',
    styleUrls: ['./scanner-overlay.component.scss'],
    standalone: true,
    imports: [CommonModule, IonIcon]
})
export class ScannerOverlayComponent {
    @Input() visible = false;

    /** Texto guía bajo el marco. */
    @Input() hint = 'Apunta al código de barras';

    /** Muestra el botón ✕ (one-shot). El POS lo apaga y usa su propio badge proyectado. */
    @Input() showClose = true;

    @Output() cerrar = new EventEmitter<void>();

    constructor() {
        addIcons({ closeOutline });
    }
}
