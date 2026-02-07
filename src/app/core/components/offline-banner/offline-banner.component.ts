import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonButton, IonSpinner } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { cloudOfflineOutline, refreshOutline } from 'ionicons/icons';
import { NetworkService } from '@core/services/network.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-offline-banner',
  templateUrl: './offline-banner.component.html',
  styleUrls: ['./offline-banner.component.scss'],
  standalone: true,
  imports: [CommonModule, IonIcon, IonButton, IonSpinner]
})
export class OfflineBannerComponent implements OnInit, OnDestroy {
  private networkService = inject(NetworkService);
  private subscription?: Subscription;

  isOffline = false;
  isChecking = false;

  constructor() {
    addIcons({ cloudOfflineOutline, refreshOutline });
  }

  ngOnInit() {
    // Suscribirse a cambios de red
    this.subscription = this.networkService.getNetworkStatus().subscribe(isOnline => {
      this.isOffline = !isOnline;
      // Si vuelve la conexión, quitar el estado de checking
      if (isOnline) {
        this.isChecking = false;
      }
    });
  }

  ngOnDestroy() {
    this.subscription?.unsubscribe();
  }

  /**
   * Verifica manualmente la conexión
   */
  async retryConnection() {
    this.isChecking = true;
    try {
      await this.networkService.checkConnection();
      // Esperar un momento para que el usuario vea el feedback
      await new Promise(resolve => setTimeout(resolve, 500));
    } finally {
      this.isChecking = false;
    }
  }
}
