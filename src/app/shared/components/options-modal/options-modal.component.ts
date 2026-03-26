import { Component, inject, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
    checkmarkOutline, arrowDownOutline, arrowUpOutline,
    cashOutline, cardOutline, phonePortraitOutline, handRightOutline,
    cameraOutline, imagesOutline, addCircleOutline, createOutline,
    trashOutline, banOutline, receiptOutline, documentTextOutline,
    documentOutline, shareOutline, closeOutline
} from 'ionicons/icons';

export interface ModalOption {
    label: string;
    icon?: string;
    value: string;
    color?: string;
    subtitle?: string;
}

export interface ModalOptionGroup {
    title?: string;
    options: ModalOption[];
}

@Component({
    selector: 'app-options-modal',
    templateUrl: './options-modal.component.html',
    styleUrls: ['./options-modal.component.scss'],
    standalone: true,
    imports: [CommonModule, IonicModule]
})
export class OptionsModalComponent {
    constructor() {
        addIcons({
            checkmarkOutline, arrowDownOutline, arrowUpOutline,
            cashOutline, cardOutline, phonePortraitOutline, handRightOutline,
            cameraOutline, imagesOutline, addCircleOutline, createOutline,
            trashOutline, banOutline, receiptOutline, documentTextOutline,
            documentOutline, shareOutline, closeOutline
        });
    }

    @Input() title = 'Opciones';
    @Input() subtitle?: string;
    @Input() groups: ModalOptionGroup[] = [];
    @Input() selectedValue?: string;

    private modalCtrl = inject(ModalController);

    seleccionar(option: ModalOption) {
        this.modalCtrl.dismiss(option.value);
    }
}
