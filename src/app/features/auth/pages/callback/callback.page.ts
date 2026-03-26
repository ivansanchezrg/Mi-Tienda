import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonSpinner } from '@ionic/angular/standalone';
import { SupabaseService } from 'src/app/core/services/supabase.service';
import { LoggerService } from 'src/app/core/services/logger.service';
import { AuthService } from '../../../auth/services/auth.service';
import { Capacitor } from '@capacitor/core';

@Component({
  selector: 'app-callback',
  template: `
    <ion-content class="ion-text-center ion-padding">
      <div style="display: flex; height: 100%; align-items: center; justify-content: center; flex-direction: column;">
        <ion-spinner name="crescent" color="primary"></ion-spinner>
        <p>Verificando sesión...</p>
      </div>
    </ion-content>
  `,
  standalone: true,
  imports: [IonContent, IonSpinner]
})
export class CallbackPage implements OnInit, OnDestroy {
  private supabaseSvc = inject(SupabaseService);
  private authService = inject(AuthService);
  private router = inject(Router);
  private logger = inject(LoggerService);

  private authSubscription: { unsubscribe: () => void } | null = null;

  async ngOnInit() {
    if (Capacitor.isNativePlatform()) {
      await this.handleAndroidCallback();
    } else {
      await this.handleWebCallback();
    }
  }

  ngOnDestroy() {
    this.authSubscription?.unsubscribe();
  }

  private async handleAndroidCallback() {
    const url = this.supabaseSvc.pendingDeepLinkUrl;

    if (!url) {
      this.logger.warn('CallbackPage', 'Android callback sin pendingDeepLinkUrl');
      this.goToLogin();
      return;
    }

    const hashIndex = url.indexOf('#');
    if (hashIndex === -1) {
      this.logger.warn('CallbackPage', 'Android callback sin hash en URL');
      this.goToLogin();
      return;
    }

    const hash = url.substring(hashIndex + 1);
    const params = new URLSearchParams(hash);

    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    this.supabaseSvc.pendingDeepLinkUrl = null;

    if (!accessToken || !refreshToken) {
      this.logger.warn('CallbackPage', 'Android callback sin tokens en hash');
      this.goToLogin();
      return;
    }

    const { error } = await this.supabaseSvc.client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken
    });

    if (error) {
      this.logger.error('CallbackPage', 'Error setting session', error);
      this.goToLogin();
      return;
    }

    this.logger.info('CallbackPage', 'Sesión Android establecida correctamente');
    await this.validateAndRedirect();
  }

  private async handleWebCallback() {
    const { data } = await this.supabaseSvc.client.auth.getSession();

    if (data.session) {
      this.logger.info('CallbackPage', 'Sesión web encontrada directamente');
      await this.validateAndRedirect();
      return;
    }

    this.logger.info('CallbackPage', 'Esperando evento SIGNED_IN via onAuthStateChange');
    const { data: listener } = this.supabaseSvc.client.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        this.logger.info('CallbackPage', 'Evento SIGNED_IN recibido');
        this.authSubscription?.unsubscribe();
        await this.validateAndRedirect();
      }
    });

    this.authSubscription = listener.subscription;
  }

  /** Valida que el usuario exista en la tabla antes de dejarlo entrar */
  private async validateAndRedirect() {
    const isValid = await this.authService.validarUsuario();
    if (isValid) {
      this.goHome();
    }
    // Si no es válido, validarUsuario() ya cierra sesión y redirige
  }

  private goHome() {
    this.router.navigate(['/home'], { replaceUrl: true });
  }

  private goToLogin() {
    this.router.navigate(['/auth/login'], { replaceUrl: true });
  }
}
