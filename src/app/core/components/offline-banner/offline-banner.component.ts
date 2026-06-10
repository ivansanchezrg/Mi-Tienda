import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { cloudOfflineOutline, cloudUploadOutline } from 'ionicons/icons';
import { NetworkService } from '@core/services/network.service';
import { OutboxService } from '@core/services/outbox.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-offline-banner',
  templateUrl: './offline-banner.component.html',
  styleUrls: ['./offline-banner.component.scss'],
  standalone: true,
  imports: [IonIcon]
})
export class OfflineBannerComponent implements OnInit, OnDestroy {
  private networkService = inject(NetworkService);
  private outbox = inject(OutboxService);
  private router = inject(Router);
  private subs = new Subscription();

  isOffline = false;
  pendientes = 0;

  // Clase en <body> que indica que el banner ocupa la franja superior.
  // El theme global anula el safe-area-top de los toolbars mientras está activa,
  // evitando que el espacio de la status bar se cuente dos veces (banner + header).
  private static readonly BODY_CLASS = 'offline-banner-visible';

  constructor() {
    addIcons({ cloudOfflineOutline, cloudUploadOutline });
  }

  ngOnInit() {
    this.subs.add(
      this.networkService.getNetworkStatus().subscribe(isOnline => {
        this.isOffline = !isOnline;
        this.actualizarBodyClass();
      })
    );
    // El badge de cola se muestra con o sin red: offline al encolar, online mientras drena.
    this.subs.add(
      this.outbox.pendientes$.subscribe(n => {
        this.pendientes = n;
        this.actualizarBodyClass();
      })
    );
    void this.outbox.refrescarContador();
  }

  /** El banner es visible si hay offline o hay ventas en cola sincronizando. */
  private get bannerVisible(): boolean {
    return this.isOffline || this.pendientes > 0;
  }

  private actualizarBodyClass() {
    document.body.classList.toggle(OfflineBannerComponent.BODY_CLASS, this.bannerVisible);
  }

  ngOnDestroy() {
    document.body.classList.remove(OfflineBannerComponent.BODY_CLASS);
    this.subs.unsubscribe();
  }

  irAPendientes() {
    this.router.navigate(['/ventas/pendientes']);
  }
}
