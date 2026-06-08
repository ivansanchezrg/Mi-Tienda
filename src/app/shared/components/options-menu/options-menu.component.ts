import { Component, Input, Output, EventEmitter, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    IonButton, IonIcon, IonPopover
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { ellipsisVerticalOutline, checkmarkOutline } from 'ionicons/icons';

export interface MenuOption {
    label: string;
    icon: string;
    value: any;
    active?: boolean;
    color?: string;
    separator?: boolean;
}

@Component({
    selector: 'app-options-menu',
    templateUrl: './options-menu.component.html',
    styleUrls: ['./options-menu.component.scss'],
    standalone: true,
    imports: [CommonModule, IonButton, IonIcon, IonPopover],
})
export class OptionsMenuComponent {
    @ViewChild(IonPopover) popover!: IonPopover;

    @Input() options: MenuOption[] = [];
    @Input() triggerId = 'options-menu-trigger';
    @Input() triggerColor = 'medium';
    @Input() disabled = false;

    @Output() optionSelected = new EventEmitter<MenuOption>();

    constructor() {
        addIcons({ ellipsisVerticalOutline, checkmarkOutline });
    }

    async onSelect(option: MenuOption, event: Event) {
        event.stopPropagation();
        await this.popover.dismiss();
        this.optionSelected.emit(option);
    }
}
