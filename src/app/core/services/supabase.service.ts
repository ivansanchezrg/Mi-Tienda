import { Injectable, inject, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { createClient, SupabaseClient, AuthChangeEvent } from '@supabase/supabase-js';
import { Preferences } from '@capacitor/preferences';
import { environment } from 'src/environments/environment';
import { UiService } from './ui.service';
import { LoggerService } from './logger.service';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';


@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private ui = inject(UiService);
  private logger = inject(LoggerService);
  private router = inject(Router);
  private zone = inject(NgZone);

  public client: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false // lo manejamos manualmente en callback.page.ts
    }
  });

  /** URL de deep-link pendiente de procesar (OAuth callback en Android) */
  public pendingDeepLinkUrl: string | null = null;

  /** Key de localStorage donde Supabase guarda los tokens */
  private readonly STORAGE_KEY: string;
  private readonly USUARIO_KEY = 'usuario_actual';

  /** Evita múltiples redirects simultáneos al login */
  private redirectingToLogin = false;

  constructor() {
    const projectRef = environment.supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || '';
    this.STORAGE_KEY = `sb-${projectRef}-auth-token`;
    this.setupAuthListener();
  }

  /**
   * Listener global de auth — escucha eventos del SDK de Supabase.
   *
   * Eventos relevantes:
   * - TOKEN_REFRESHED: el SDK renovó el access token automáticamente (no requiere acción)
   * - SIGNED_OUT: sesión cerrada (por logout manual o refresh token inválido)
   *
   * Cuando el SDK no puede renovar el token (refresh token expirado, revocado, o
   * error de red persistente), emite SIGNED_OUT automáticamente.
   */
  private setupAuthListener(): void {
    this.client.auth.onAuthStateChange((event: AuthChangeEvent, session) => {
      this.zone.run(() => {
        if (event === 'TOKEN_REFRESHED') {
          this.logger.info('SupabaseService', 'Token renovado automáticamente por el SDK');
        }

        if (event === 'SIGNED_OUT') {
          this.logger.warn('SupabaseService', 'Sesión cerrada — evento SIGNED_OUT del SDK');
          // Solo redirigir si NO estamos ya en una ruta de auth (evita loops)
          const currentUrl = this.router.url;
          if (!currentUrl.startsWith('/auth')) {
            this.handleExpiredSession();
          }
        }
      });
    });
  }

  /**
   * Inicia el flujo de OAuth.
   * Supabase se encarga de abrir el navegador.
   */
  async signInWithGoogle() {
    const isNative = Capacitor.isNativePlatform();

    const redirectUrl = isNative
      ? 'ec.mitienda.app://auth/callback'
      : `${window.location.origin}/auth/callback`;

    const { data, error } = await this.client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        skipBrowserRedirect: isNative // Nativo: nosotros controlamos el navegador. Web: Supabase redirige.
      }
    });

    if (error) throw error;

    // En nativo, abrimos la URL con el plugin Browser para poder cerrarla después
    if (isNative && data?.url) {
      await Browser.open({ url: data.url, windowName: '_self' });
    }

    return data;
  }


  /**
   * MÉTODO MAESTRO: Maneja Loading, Error y Data
   * @param promise La promesa de la query de Supabase
   * @param successMessage (Opcional) Mensaje para mostrar Toast si sale bien
   * @param options.showLoading (Opcional) Si mostrar spinner de carga, default: false
   */
  async call<T>(
    promise: PromiseLike<any>,
    successMessage?: string,
    options?: { showLoading?: boolean }
  ): Promise<T | null> { // Retorna null si hay error

    const showLoading = options?.showLoading === true;
    if (showLoading) await this.ui.showLoading();

    try {
      // 1. Ejecutamos la promesa
      const response = await promise;

      // 2. Verificamos si Supabase devolvió error (Supabase no siempre hace throw)
      if (response.error) {
        throw response.error; // Forzamos el catch
      }

      // 3. Éxito: Mostrar Toast opcional
      if (successMessage) {
        this.ui.showSuccess(successMessage);
      }

      // 4. Retornar solo la DATA limpia
      return response.data as T;

    } catch (error: any) {
      // 5. Manejo Centralizado de Errores
      this.logger.error('SupabaseService', 'Query error', error);

      const msg = error.message || error.error_description || 'Ocurrió un error inesperado';

      // JWT expirado/inválido → limpiar sesión y redirigir al login
      if (this.isJwtError(msg)) {
        if (showLoading) await this.ui.hideLoading();
        await this.ui.showError(msg);
        await this.handleExpiredSession();
        return null;
      }

      await this.ui.showError(msg);
      return null;

    } finally {
      // 6. Cerrar el loading solo si se abrió
      if (showLoading) await this.ui.hideLoading();
    }
  }

  // ==========================================
  // JWT / Sesión
  // ==========================================

  /** Detecta errores de JWT expirado o inválido en respuestas de Supabase */
  private isJwtError(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes('jwt') && (lower.includes('expired') || lower.includes('invalid'));
  }

  /**
   * Limpia sesión local y redirige al login.
   * Se llama cuando:
   * - Una query falla con JWT expirado (call() lo detecta)
   * - El SDK emite SIGNED_OUT (refresh token inválido/expirado)
   */
  async handleExpiredSession(): Promise<void> {
    if (this.redirectingToLogin) return;
    this.redirectingToLogin = true;

    this.logger.warn('SupabaseService', 'Sesión expirada — limpiando y redirigiendo al login');

    // Limpiar sesión de Supabase (ignora errores si no hay red)
    this.client.auth.signOut().catch(() => {});

    // Limpiar storage local
    localStorage.removeItem(this.STORAGE_KEY);
    await Preferences.remove({ key: this.USUARIO_KEY }).catch(() => {});

    await this.router.navigate(['/auth/login'], { replaceUrl: true });
    this.redirectingToLogin = false;
  }

  /**
   * Intenta renovar la sesión proactivamente.
   * Se llama cuando la app vuelve del background (appStateChange → active).
   *
   * El SDK de Supabase tiene auto-refresh, pero su timer interno se detiene
   * cuando la app está en background/suspendida. Al volver, el access token
   * puede estar expirado y el SDK aún no lo sabe. Este método fuerza el
   * refresh inmediato para evitar que la primera query falle con JWT expired.
   *
   * Si el refresh token también expiró (>30 días sin abrir la app), el SDK
   * emitirá SIGNED_OUT y el listener global redirigirá al login.
   */
  async refreshSessionOnResume(): Promise<void> {
    try {
      const { data } = await this.client.auth.getSession();
      if (!data.session) return; // no hay sesión, nada que renovar

      const { error } = await this.client.auth.refreshSession();
      if (error) {
        this.logger.error('SupabaseService', 'Refresh on resume falló', error);
        // No redirigimos aquí — el listener de SIGNED_OUT lo hará si corresponde
      } else {
        this.logger.info('SupabaseService', 'Sesión renovada al volver del background');
      }
    } catch (err) {
      this.logger.error('SupabaseService', 'Error en refreshSessionOnResume', err);
    }
  }
}