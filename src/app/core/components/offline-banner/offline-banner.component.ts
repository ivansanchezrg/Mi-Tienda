import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { cloudOfflineOutline } from 'ionicons/icons';
import { NetworkService } from '@core/services/network.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-offline-banner',
  templateUrl: './offline-banner.component.html',
  styleUrls: ['./offline-banner.component.scss'],
  standalone: true,
  imports: [CommonModule, IonIcon]
})
export class OfflineBannerComponent implements OnInit, OnDestroy {
  private networkService = inject(NetworkService);
  private subscription?: Subscription;

  isOffline = false;

  constructor() {
    addIcons({ cloudOfflineOutline });
  }

  ngOnInit() {
    // Suscribirse a cambios de red
    this.subscription = this.networkService.getNetworkStatus().subscribe(isOnline => {
      this.isOffline = !isOnline;
    });
  }

  ngOnDestroy() {
    this.subscription?.unsubscribe();
  }
}
