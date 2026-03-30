import { Component, Input } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  documentTextOutline, cartOutline, storefrontOutline,
  checkmarkCircleOutline, personOutline, phonePortraitOutline,
  busOutline, handRightOutline, cubeOutline, banOutline,
  cashOutline, walletOutline, receiptOutline
} from 'ionicons/icons';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [IonIcon],
  template: `
    <div class="empty-state">
      <ion-icon [name]="icon" class="empty-icon"></ion-icon>
      @if (title) {
        <p class="empty-title">{{ title }}</p>
      }
      @if (hint) {
        <p class="empty-hint">{{ hint }}</p>
      }
    </div>
  `,
  styles: [`
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      min-height: 55vh;
      padding: var(--spacing-xl);
      gap: var(--spacing-xs);
    }

    .empty-icon {
      font-size: 64px;
      color: var(--ion-color-primary);
      opacity: 0.18;
      margin-bottom: var(--spacing-sm);
    }

    .empty-title {
      font-size: 17px;
      font-weight: 700;
      color: var(--ion-text-color);
      opacity: 0.4;
      margin: 0;
    }

    .empty-hint {
      font-size: 13px;
      color: var(--ion-color-medium);
      max-width: 240px;
      line-height: 1.4;
      margin: 0;
    }
  `]
})
export class EmptyStateComponent {
  @Input({ required: true }) icon!: string;
  @Input() title?: string;
  @Input() hint?: string;

  constructor() {
    addIcons({
      documentTextOutline, cartOutline, storefrontOutline,
      checkmarkCircleOutline, personOutline, phonePortraitOutline,
      busOutline, handRightOutline, cubeOutline, banOutline,
      cashOutline, walletOutline, receiptOutline
    });
  }
}
