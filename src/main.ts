import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';
import { LOCALE_ID } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';

registerLocaleData(localeEs);

// Supabase intenta adquirir un Navigator LockManager lock para sincronizar tokens
// entre pestañas. En Capacitor/WebView no hay multi-tab real y el lock falla
// inmediatamente. No afecta funcionalidad — solo es ruido en la consola.
window.addEventListener('unhandledrejection', (event) => {
  if (String(event.reason).includes('NavigatorLockAcquireTimeoutError')) {
    event.preventDefault();
  }
});

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: LOCALE_ID, useValue: 'es' },
    provideIonicAngular(),
    provideRouter(routes, withPreloading(PreloadAllModules)),
  ],
});
