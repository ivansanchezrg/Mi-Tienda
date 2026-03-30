import { Component, Input, Output, EventEmitter, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    IonButton, IonIcon, IonPopover,
    IonList, IonItem, IonLabel
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { ellipsisVerticalOutline, checkmarkOutline } from 'ionicons/icons';

export interface MenuOption {
    /** Texto visible de la opción */
    label: string;
    /** Nombre del ícono de Ionicons */
    icon: string;
    /** Valor arbitrario que se emite al seleccionar */
    value: any;
    /** Muestra el checkmark (✓) a la derecha */
    active?: boolean;
    /** Color Ionic: 'primary' | 'danger' | 'medium' … */
    color?: string;
}

@Component({
    selector: 'app-options-menu',
    templateUrl: './options-menu.component.html',
    styleUrls: ['./options-menu.component.scss'],
    standalone: true,
    imports: [CommonModule, IonButton, IonIcon, IonPopover, IonList, IonItem, IonLabel],
})
export class OptionsMenuComponent {
    /** Lista de opciones del menú */
    @Input() options: MenuOption[] = [];

    /** ID único del trigger (útil si hay varios menús en la misma página) */
    @Input() triggerId = 'options-menu-trigger';

    /** Color del botón ⋮ */
    @Input() triggerColor = 'medium';

    /** Deshabilita el menú: muestra cursor prohibido y no abre el popover */
    @Input() disabled = false;

    /** Se emite con la opción seleccionada */
    @Output() optionSelected = new EventEmitter<MenuOption>();

    constructor() {
        addIcons({ ellipsisVerticalOutline, checkmarkOutline });
    }

    onSelect(option: MenuOption) {
        this.optionSelected.emit(option);
    }
}
