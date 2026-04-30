import { Injectable, inject, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { createClient, SupabaseClient, AuthChangeEvent } from '@supabase/supabase-js';
import { Preferences } from '@capacitor/preferences';
import { environment } from 'src/environments/environment';
import { UiService } from './ui.service';
import { LoggerService } from './logger.service';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { ROUTES } from '@core/config/routes.config';


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

  private readonly STORAGE_KEY: string;
  private readonly USUARIO_KEY = 'usuario_actual';

  /** Evita múltiples redirects simultáneos al login */
  private redirectingToLogin = false;

  /** Timestamp del último intento de refresh on-resume (ms). Usado para throttle. */
  private lastResumeRefreshAt = 0;

  /** Promesa del refresh en curso, para evitar refreshes concurrentes. */
  private resumeRefreshInFlight: Promise<void> | null = null;

  /**
   * Hooks que se ejecutan antes de limpiar la sesión en handleExpiredSession().
   * Permite que otros servicios (AuthService, TurnosCajaService, etc.) cierren
   * recursos propios (canales de Realtime, subscriptions) sin crear dependencias
   * circulares. Cada servicio registra su callback en su constructor.
   *
   * Es un array (no un solo callback) porque varios servicios necesitan
   * engancharse al mismo punto de cleanup.
   */
  private beforeCleanupListeners: Array<() => Promise<void> | void> = [];

  /** Registra un callback que se ejecutará antes de limpiar la sesión. */
  registerBeforeCleanup(fn: () => Promise<void> | void): void {
    this.beforeCleanupListeners.push(fn);
  }

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
   * - AuthService.logout() / logoutSilent() (logout manual)
   * - AuthService detecta que el usuario fue eliminado via Realtime (DELETE)
   *
   * Antes de limpiar la sesión, ejecuta el hook onBeforeSessionCleanup (si existe)
   * para dar oportunidad a otros servicios de cerrar recursos (canales Realtime, etc.).
   */
  async handleExpiredSession(): Promise<void> {
    if (this.redirectingToLogin) return;
    this.redirectingToLogin = true;

    this.logger.warn('SupabaseService', 'Sesión expirada — limpiando y redirigiendo al login');

    // Hooks pre-cleanup (ej: cerrar canales de Realtime de usuario y turnos).
    // Se ejecutan en paralelo porque son independientes entre si.
    if (this.beforeCleanupListeners.length > 0) {
      await Promise.all(
        this.beforeCleanupListeners.map(async (fn) => {
          try {
            await fn();
          } catch (err) {
            this.logger.error('SupabaseService', 'Error en beforeCleanup listener', err);
          }
        })
      );
    }

    // Limpiar storage local ANTES de signOut para evitar race conditions
    // (signOut emite SIGNED_OUT que re-entra a este método)
    localStorage.removeItem(this.STORAGE_KEY);
    await Preferences.remove({ key: this.USUARIO_KEY }).catch(() => {});

    // Limpiar sesión de Supabase (ignora errores si no hay red).
    // signOut() emite SIGNED_OUT via onAuthStateChange — el listener
    // verifica `currentUrl.startsWith('/auth')` y no re-ejecuta porque
    // ya estamos en /auth/login después del navigate() abajo.
    this.client.auth.signOut().catch(() => {});

    await this.router.navigate([ROUTES.auth.login], { replaceUrl: true });

    // Resetear flag con delay mínimo para que el SIGNED_OUT del signOut()
    // (que llega async) encuentre redirectingToLogin=true y no re-entre.
    setTimeout(() => { this.redirectingToLogin = false; }, 500);
  }

  /**
   * Intenta renovar la sesión proactivamente cuando la app vuelve del background.
   *
   * Se llama desde el listener de appStateChange en AppComponent.
   *
   * Optimizaciones aplicadas para evitar lag al volver del background:
   *
   * 1. THROTTLE — Si el último refresh fue hace menos de 30 segundos, salir
   *    inmediatamente. Android dispara appStateChange en ráfagas (desbloqueo,
   *    notificaciones, switch rápido entre apps), no tiene sentido refrescar
   *    en cada uno.
   *
   * 2. SKIP TOKEN SANO — Si al token le quedan más de 5 minutos de vida, no
   *    refrescar. El JWT dura 1 hora, refrescarlo después de 1 min de inactividad
   *    es desperdicio y causa el lag perceptible al volver a la app.
   *
   * 3. ANTI-CONCURRENCIA — Si ya hay un refresh en curso, reutilizar la misma
   *    promesa en lugar de disparar otro paralelo.
   *
   * El SDK de Supabase tiene auto-refresh interno, pero su timer se detiene
   * cuando la app está suspendida. Por eso necesitamos este refresh manual
   * cuando realmente hace falta (token a punto de expirar).
   *
   * Si el refresh token también expiró (>30 días sin abrir la app), el SDK
   * emitirá SIGNED_OUT y el listener global redirigirá al login.
   */
  async refreshSessionOnResume(): Promise<void> {
    // 1. THROTTLE — bloquear ráfagas de appStateChange (desbloqueo, switches rápidos, etc.)
    const nowMs = Date.now();
    if (nowMs - this.lastResumeRefreshAt < 30_000) {
      return;
    }

    // 3. ANTI-CONCURRENCIA — si ya hay un refresh en curso, no disparar otro
    if (this.resumeRefreshInFlight) {
      return;
    }

    this.lastResumeRefreshAt = nowMs;

    this.resumeRefreshInFlight = (async () => {
      try {
        const { data } = await this.client.auth.getSession();
        if (!data.session) return; // no hay sesión, nada que renovar

        // 2. SKIP TOKEN SANO — expires_at viene en segundos (Unix timestamp)
        const expiresAt = data.session.expires_at ?? 0;
        const nowSec = Math.floor(Date.now() / 1000);
        const secondsLeft = expiresAt - nowSec;

        // Si quedan más de 5 minutos, el token está sano — no refrescar
        if (secondsLeft > 300) {
          return;
        }

        // Quedan menos de 5 min → refrescar proactivamente
        const { error } = await this.client.auth.refreshSession();
        if (error) {
          this.logger.error('SupabaseService', 'Refresh on resume falló', error);
          // No redirigimos aquí — el listener de SIGNED_OUT lo hará si corresponde
        } else {
          this.logger.info('SupabaseService', 'Sesión renovada al volver del background');
        }
      } catch (err) {
        this.logger.error('SupabaseService', 'Error en refreshSessionOnResume', err);
      } finally {
        this.resumeRefreshInFlight = null;
      }
    })();

    return this.resumeRefreshInFlight;
  }
}