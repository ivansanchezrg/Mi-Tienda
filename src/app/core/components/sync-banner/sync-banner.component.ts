import { Component, OnDestroy, effect, inject } from '@angular/core';
import { addIcons } from 'ionicons';
import { checkmarkCircleOutline } from 'ionicons/icons';
import { SyncBannerService } from '@core/services/sync-banner.service';
import { BannerComponent } from '@shared/components/banner/banner.component';

/**
 * Franja verde "Conexión restablecida" — ver SyncBannerService para el criterio de
 * cuándo se dispara (solo reconexión de red, nunca en cada resume de background).
 */
@Component({
  selector: 'app-sync-banner',
  templateUrl: './sync-banner.component.html',
  styleUrls: ['./sync-banner.component.scss'],
  standalone: true,
  imports: [BannerComponent],
})
export class SyncBannerComponent implements OnDestroy {
  private syncBanner = inject(SyncBannerService);

  // Clase en <body> que indica que este banner ocupa la franja superior — mismo
  // mecanismo que offline-banner (ver global.scss: anula el safe-area-top de los
  // toolbars de página mientras el banner está montado en flujo).
  private static readonly BODY_CLASS = 'sync-banner-visible';

  readonly visible = this.syncBanner.visible;

  constructor() {
    addIcons({ checkmarkCircleOutline });
    effect(() => {
      document.body.classList.toggle(SyncBannerComponent.BODY_CLASS, this.visible());
    });
  }

  ngOnDestroy() {
    document.body.classList.remove(SyncBannerComponent.BODY_CLASS);
  }
}
