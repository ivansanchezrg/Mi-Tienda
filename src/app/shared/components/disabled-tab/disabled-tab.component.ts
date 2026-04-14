import { Component, Input, inject } from '@angular/core';
import { IonIcon, IonLabel } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { lockClosedOutline, barcodeOutline, receiptOutline } from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';

/**
 * Placeholder para tabs deshabilitadas por estado del sistema (ej: POS sin
 * caja abierta). Muestra el icono + label con candado superpuesto. Al hacer
 * click muestra un toast explicativo en lugar de navegar.
 *
 * Uso: reemplaza <ion-tab-button> cuando la feature esta OFF.
 *
 * IMPORTANTE: icon debe ser un objeto de ionicons (no un string)
 * para evitar el bug de tree-shaking en Android.
 * Pasar: [icon]="barcodeOutline" — NO: icon="barcode-outline"
 */
@Component({
  selector: 'app-disabled-tab',
  template: `
    <div class="disabled-tab-btn" (click)="onClick()">
      <div class="icon-wrapper">
        <ion-icon [icon]="icon" class="feature-icon"></ion-icon>
        <div class="lock-badge">
          <ion-icon name="lock-closed-outline"></ion-icon>
        </div>
      </div>
      <ion-label>{{ label }}</ion-label>
    </div>
  `,
  styles: [`
    :host {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .disabled-tab-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      cursor: pointer;
      user-select: none;
      width: 100%;
      padding: 4px 0;
    }

    .icon-wrapper {
      position: relative;
      width: 26px;
      height: 26px;
    }

    .feature-icon {
      font-size: 24px;
      color: var(--ion-color-step-600);
    }

    .lock-badge {
      position: absolute;
      top: -5px;
      right: -7px;
      width: 14px;
      height: 14px;
      background: var(--ion-color-step-600);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;

      ion-icon {
        font-size: 8px;
        color: var(--ion-background-color);
      }
    }

    ion-label {
      font-size: 10px;
      color: var(--ion-color-step-600);
      letter-spacing: 0.01em;
    }
  `],
  standalone: true,
  imports: [IonIcon, IonLabel]
})
export class DisabledTabComponent {
  @Input() icon!: unknown;  // objeto ionicon, no string
  @Input() label!: string;
  /** Mensaje que se muestra al hacer click. Default: mensaje generico del POS. */
  @Input() disabledMessage = 'Abri la caja desde Inicio para usar el POS';

  private ui = inject(UiService);

  constructor() {
    addIcons({ lockClosedOutline, barcodeOutline, receiptOutline });
  }

  async onClick() {
    await this.ui.showToast(this.disabledMessage, 'warning');
  }
}
