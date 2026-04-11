import { Component, NgZone, inject } from '@angular/core';
import { Router } from '@angular/router';
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { SupabaseService } from './core/services/supabase.service';
import { TurnosCajaService } from './features/dashboard/services/turnos-caja.service';
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

  // Instanciamos TurnosCajaService aqui para garantizar que su constructor
  // corra desde el bootstrap del app — asi se suscribe a usuarioActual$ de
  // AuthService antes de cualquier login. providedIn:'root' es lazy, sin esta
  // inyeccion el servicio no existe hasta que alguna pagina lo pida.
  private turnosCaja = inject(TurnosCajaService);

  constructor() {
    this.setupDeepLinkListener();
    this.setupResumeListener();
  }

  private setupDeepLinkListener() {
    if (!Capacitor.isNativePlatform()) return;

    App.addListener('appUrlOpen', async (event: URLOpenListenerEvent) => {
      await Browser.close();
      this.supabase.pendingDeepLinkUrl = event.url;

      this.zone.run(() => {
        if (event.url.includes('auth/callback')) {
          this.router.navigateByUrl('/auth/callback');
        }
      });
    });
  }

  /**
   * Al volver del background, fuerza un refresh de la sesión.
   * El timer de auto-refresh del SDK de Supabase se detiene cuando la app
   * está suspendida. Si pasaron >1h en background, el access token expiró
   * y la primera query fallaría con "JWT expired". Este listener renueva
   * el token proactivamente al volver.
   */
  private setupResumeListener() {
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        this.zone.run(() => {
          this.supabase.refreshSessionOnResume();
        });
      }
    });
  }
}
