import { Component, Input } from '@angular/core';
import {
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardSubtitle,
  IonCardContent,
  IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { constructOutline, checkmarkCircleOutline } from 'ionicons/icons';

export interface Feature {
  label: string;
}

@Component({
  selector: 'app-under-construction',
  standalone: true,
  imports: [
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardSubtitle,
    IonCardContent,
    IonIcon
  ],
  template: `
    <div class="page-container">
      <ion-card>
        <ion-card-header>
          <ion-card-title>
            {{ title }}
          </ion-card-title>
          <ion-card-subtitle>Módulo en construcción</ion-card-subtitle>
        </ion-card-header>

        <ion-card-content>
          <div class="placeholder-content">
            <ion-icon name="construct-outline" class="large-icon"></ion-icon>
            <h3>Próximamente</h3>
            <p>{{ description }}</p>

            @if (features.length > 0) {
              <div class="features-list">
                <span class="features-title">Lo que viene:</span>
                @for (feature of features; track feature.label) {
                  <div class="feature-item">
                    <ion-icon name="checkmark-circle-outline"></ion-icon>
                    <span>{{ feature.label }}</span>
                  </div>
                }
              </div>
            }
          </div>
        </ion-card-content>
      </ion-card>
    </div>
  `,
  styles: [`
    .page-container {
      padding: 16px;
    }

    ion-card {
      border-radius: 16px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
    }

    ion-card-header {
      padding-bottom: 0;
      padding-inline-start: 16px;
    }

    ion-card-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 17px;
      font-weight: 700;

      ion-icon {
        font-size: 22px;
        color: var(--ion-color-primary);
      }
    }

    ion-card-subtitle {
      margin-top: 4px;
      font-size: 13px;
    }

    ion-card-content {
      padding: 0;
    }

    .placeholder-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 32px 20px;

      .large-icon {
        font-size: 72px;
        color: var(--ion-color-medium);
        opacity: 0.4;
        margin-bottom: 16px;
      }

      h3 {
        font-size: 20px;
        font-weight: 700;
        color: var(--ion-color-dark);
        margin: 0 0 8px 0;
      }

      p {
        font-size: 14px;
        color: var(--ion-color-medium);
        margin: 0 0 24px 0;
        line-height: 1.5;
        max-width: 280px;
      }
    }

    .features-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      max-width: 300px;
    }

    .features-title {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--ion-color-medium);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .feature-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      background: var(--ion-color-light);
      border-radius: 12px;

      ion-icon {
        font-size: 20px;
        color: var(--ion-color-success);
        flex-shrink: 0;
      }

      span {
        font-size: 14px;
        color: var(--ion-color-dark);
        font-weight: 500;
        text-align: left;
      }
    }
  `]
})
export class UnderConstructionComponent {
  @Input() title = 'Módulo';
  @Input() icon = 'construct-outline';
  @Input() description = 'Este módulo estará disponible próximamente.';
  @Input() features: Feature[] = [];

  constructor() {
    addIcons({ constructOutline, checkmarkCircleOutline });
  }
}
