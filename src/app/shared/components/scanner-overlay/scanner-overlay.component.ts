import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';

@Component({
    selector: 'app-scanner-overlay',
    templateUrl: './scanner-overlay.component.html',
    styleUrls: ['./scanner-overlay.component.scss'],
    standalone: true,
    imports: [CommonModule, IonIcon]
})
export class ScannerOverlayComponent {
    @Input() visible = false;
    @Output() cerrar = new EventEmitter<void>();

    constructor() {
        addIcons({ closeOutline });
    }
}
