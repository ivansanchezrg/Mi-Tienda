import { Component, NgZone, inject } from '@angular/core';
import { Router } from '@angular/router';
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { SupabaseService } from './core/services/supabase.service';
import { Capacitor } from '@capacitor/core';
import { OfflineBannerComponent } from './core/components/offline-banner/offline-banner.component';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet, OfflineBannerComponent],
})
export class AppComponent {

  private supabase = inject(SupabaseService);
  private router = inject(Router);
  private zone = inject(NgZone);

  constructor() {
    this.setupDeepLinkListener();
  }

  setupDeepLinkListener() {
    if (!Capacitor.isNativePlatform()) return;

    App.addListener('appUrlOpen', async (event: URLOpenListenerEvent) => {
      // 1. Cerrar la pestaña del navegador que abrimos con Browser.open()
      await Browser.close();

      // 2. Guardamos la URL completa (trae el access_token en el hash)
      this.supabase.pendingDeepLinkUrl = event.url;

      // 3. Navegamos a la página de Callback para procesar el token
      this.zone.run(() => {
        if (event.url.includes('auth/callback')) {
            this.router.navigateByUrl('/auth/callback');
        }
      });
    });
  }
}
