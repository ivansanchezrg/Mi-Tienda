import { Component, NgZone, OnDestroy, inject } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { filter, take } from 'rxjs/operators';
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { SplashScreen } from '@capacitor/splash-screen';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { PluginListenerHandle } from '@capacitor/core';
import { SupabaseService } from './core/services/supabase.service';
import { TurnosCajaService } from './features/caja/services/turnos-caja.service';
import { Capacitor } from '@capacitor/core';
import { OfflineBannerComponent } from './core/components/offline-banner/offline-banner.component';
import { ROUTES } from './core/config/routes.config';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet, OfflineBannerComponent],
})
export class AppComponent implements OnDestroy {

  private supabase = inject(SupabaseService);
  private router = inject(Router);
  private zone = inject(NgZone);

  // Instanciamos TurnosCajaService aqui para garantizar que su constructor
  // corra desde el bootstrap del app — asi se suscribe a usuarioActual$ de
  // AuthService antes de cualquier login. providedIn:'root' es lazy, sin esta
  // inyeccion el servicio no existe hasta que alguna pagina lo pida.
  private turnosCaja = inject(TurnosCajaService);

  private wheelListener = (event: WheelEvent) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === 'number') {
      target.blur();
    }
  };
  private capacitorListeners: PluginListenerHandle[] = [];

  constructor() {
    this.setupDeepLinkListener();
    this.setupResumeListener();
    this.setupSplashScreenHide();
    this.setupBlurOnNavigation();
    this.setupNumberInputNoScroll();
  }

  async ngOnDestroy() {
    document.removeEventListener('wheel', this.wheelListener);
    await Promise.all(this.capacitorListeners.map(l => l.remove()));
    this.capacitorListeners = [];
  }

  /**
   * Oculta el splash screen nativo solo cuando la primera ruta termina de
   * renderizar. Evita el flash blanco entre el splash de Android y el primer
   * paint de Angular. Requiere `launchAutoHide: false` en capacitor.config.ts
   * — sin eso, Capacitor lo oculta automáticamente al montar el WebView.
   *
   * Timeout de seguridad de 6s: si NavigationEnd nunca llega (guard que falla,
   * error de red en el bootstrap) el splash no queda bloqueado indefinidamente.
   */
  private setupSplashScreenHide() {
    if (!Capacitor.isNativePlatform()) return;

    let hidden = false;
    const hide = async () => {
      if (hidden) return;
      hidden = true;
      await SplashScreen.hide({ fadeOutDuration: 200 });
    };

    // Ocultar al primer NavigationEnd — la ruta real ya fue resuelta y renderizada
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        take(1)
      )
      .subscribe(() => hide());

    // Fallback: si en 6s no llegó NavigationEnd, ocultar igualmente
    setTimeout(() => hide(), 6000);
  }

  private setupBlurOnNavigation() {
    this.router.events
      .pipe(filter((e): e is NavigationStart => e instanceof NavigationStart))
      .subscribe(() => (document.activeElement as HTMLElement)?.blur());
  }

  private setupNumberInputNoScroll() {
    document.addEventListener('wheel', this.wheelListener, { passive: true });
  }

  private async setupDeepLinkListener() {
    if (!Capacitor.isNativePlatform()) return;

    const handle = await App.addListener('appUrlOpen', async (event: URLOpenListenerEvent) => {
      await Browser.close();
      this.supabase.pendingDeepLinkUrl = event.url;

      this.zone.run(() => {
        if (event.url.includes('auth/callback')) {
          this.router.navigateByUrl(ROUTES.auth.callback);
        }
      });
    });
    this.capacitorListeners.push(handle);
  }

  /**
   * Al volver del background, fuerza un refresh de la sesión.
   * El timer de auto-refresh del SDK de Supabase se detiene cuando la app
   * está suspendida. Si pasaron >1h en background, el access token expiró
   * y la primera query fallaría con "JWT expired". Este listener renueva
   * el token proactivamente al volver.
   */
  private async setupResumeListener() {
    const handle = await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        this.zone.run(() => {
          this.supabase.refreshSessionOnResume();
        });
      }
    });
    this.capacitorListeners.push(handle);
  }
}
