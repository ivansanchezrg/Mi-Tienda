import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, checkmarkOutline, readerOutline } from 'ionicons/icons';

@Component({
    selector: 'app-nueva-nota-modal',
    templateUrl: './nueva-nota-modal.component.html',
    styleUrls: ['./nueva-nota-modal.component.scss'],
    standalone: true,
    imports: [CommonModule, FormsModule, IonButton, IonIcon]
})
export class NuevaNotaModalComponent {

    private modalCtrl = inject(ModalController);

    texto = '';
    readonly MAX = 500;

    constructor() {
        addIcons({ closeOutline, checkmarkOutline, readerOutline });
    }

    get restantes(): number {
        return this.MAX - this.texto.length;
    }

    get valido(): boolean {
        return this.texto.trim().length > 0;
    }

    cancelar() {
        this.modalCtrl.dismiss(null, 'cancel');
    }

    guardar() {
        if (!this.valido) return;
        this.modalCtrl.dismiss({ texto: this.texto.trim() }, 'confirm');
    }
}
