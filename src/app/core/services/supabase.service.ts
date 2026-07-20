import { Injectable, inject, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { createClient, SupabaseClient, AuthChangeEvent } from '@supabase/supabase-js';
import { Preferences } from '@capacitor/preferences';
import { environment } from 'src/environments/environment';
import { UiService } from './ui.service';
import { LoggerService } from './logger.service';
import { NetworkService } from './network.service';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { ROUTES } from '@core/config/routes.config';
import { TIMING } from '@core/config/timing.config';
import { conTimeout, TimeoutError } from '@core/utils/timeout.util';


@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private ui = inject(UiService);
  private logger = inject(LoggerService);
  private network = inject(NetworkService);
  private router = inject(Router);
  private zone = inject(NgZone);

  public client: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // lo manejamos manualmente en callback.page.ts
      // Capacitor WebView no necesita sincronización multi-pestaña.
      // Sin este override, navigator.locks puede quedar bloqueado tras un kill
      // abrupto en Android (especialmente Xiaomi), congelando el flujo de auth.
      lock: (_name: string, _acquireTimeout: number, fn: () => Promise<any>) => fn()
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

  /**
   * Promesa del refresh en curso — pública para que authGuard la espere
   * si llega mientras el resume-refresh aún no terminó, evitando un segundo
   * getSession() paralelo que Supabase serializa internamente (~4-5s extra).
   */
  resumeRefreshInFlight: Promise<void> | null = null;

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

    // Warm-up de sesión en el milisegundo cero del bootstrap (2026-07-03).
    // Si la app estuvo horas cerrada/en reposo, el access token expiró. Antes el
    // refresh arrancaba recién en el authGuard (~1.8s después del boot) y la primera
    // RPC del home lo esperaba COMPLETO en serie (call() espera resumeRefreshInFlight)
    // → boot + refresh + RPC uno detrás de otro ≈ 4s. Arrancándolo aquí, el refresh
    // corre EN PARALELO con el bootstrap de Angular y el render del home: cuando la
    // primera query sale, el token ya está renovado (o casi). Fire-and-forget:
    // - sin sesión persistida → getSession() null → no-op inmediato
    // - token sano (>5 min de vida) → no-op (umbral interno)
    // - offline → falla silenciosa (catch interno), el guard offline maneja el acceso
    // - refresh token inválido (30+ días) → SIGNED_OUT → listener global → login
    this.refreshSessionOnResume();
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
        skipBrowserRedirect: isNative, // Nativo: nosotros controlamos el navegador. Web: Supabase redirige.
        queryParams: {
          // Fuerza el selector de cuentas de Google en cada login. Sin esto, si el
          // usuario ya tiene una sesión activa en el navegador, Google auto-entra con
          // esa cuenta sin ofrecer elegir otra. Con select_account siempre puede elegir
          // una cuenta ya logueada o tocar "Usar otra cuenta" para escribir el correo +
          // contraseña de cualquier cuenta suya, aunque NO esté agregada en el teléfono.
          prompt: 'select_account'
        }
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
   * @param options.timeoutMs (Opcional) Tope de espera para mutaciones críticas sobre
   *        red "conectada pero rota". Al vencer, se RELANZA `TimeoutError` (nunca se
   *        traga): quien pasa timeoutMs debe manejarlo en su catch. El finally cierra
   *        el loading igual.
   * @param options.silentError (Opcional) El caller controla todo el feedback de error:
   *        no se muestra el toast genérico y los errores se RELANZAN con su mensaje
   *        real (para que el catch del caller lo lea de error.message). Excepciones:
   *        "sin red detectada" retorna null (el banner global ya avisa) y el JWT
   *        expirado se maneja igual (limpiar sesión — es seguridad, no UX).
   */
  async call<T>(
    promise: PromiseLike<any>,
    successMessage?: string,
    options?: { showLoading?: boolean; timeoutMs?: number; silentError?: boolean }
  ): Promise<T | null> { // Retorna null si hay error

    const showLoading = options?.showLoading === true;
    // silentError: no mostrar NINGÚN toast de error — el caller controla el feedback
    // (ej. abrir/cerrar turno, que muestran su propio overlay). El JWT expirado sí se
    // maneja igual (limpiar sesión) porque es una excepción de seguridad, no de UX.
    const silentError = options?.silentError === true;
    if (showLoading) await this.ui.showLoading();

    try {
      // 0. Si hay un refresh de sesión en curso (token vencido al volver del
      // background), esperarlo antes de disparar la query — sin esto la request
      // saldría con el token viejo y fallaría con "JWT expired". Complemento del
      // fast path del authGuard, que ya no bloquea la navegación por este refresh.
      // La promesa nunca rechaza (refreshSessionOnResume captura internamente).
      if (this.resumeRefreshInFlight) {
        await this.resumeRefreshInFlight;
      }

      // 1. Ejecutamos la promesa (con tope de tiempo opcional para mutaciones
      // críticas sobre red "conectada pero rota" — el finally garantiza hideLoading).
      const response = options?.timeoutMs
        ? await conTimeout(promise, options.timeoutMs)
        : await promise;

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

      // Timeout de una mutación con `timeoutMs`: el servidor no respondió a tiempo
      // (red "conectada pero rota"). Quien pasa `timeoutMs` es siempre una mutación
      // crítica que maneja este caso en su propio catch (overlay/reintento), así que
      // RELANZAMOS el TimeoutError en vez de tragárnoslo. El finally cierra el loading.
      if (error instanceof TimeoutError) {
        throw error;
      }

      const rawMsg = error.message || error.error_description || 'Ocurrió un error inesperado';
      const superadminMatch = rawMsg.match(/superadmin_blocked:\s*(.+)/i);
      const msg = superadminMatch ? superadminMatch[1].trim() : rawMsg;

      // Sin red: el fallo es por falta de conexión. El banner global (app-offline-banner)
      // ya comunica el estado offline → no mostrar toast redundante. Único punto de la app
      // que sabe con certeza que una query falló por red (tiene el error original, no un string).
      if (!this.network.isConnected() && this.esErrorDeTransporte(error)) {
        if (showLoading) await this.ui.hideLoading();
        return null;
      }

      // JWT expirado/inválido → limpiar sesión y redirigir al login
      if (this.isJwtError(msg)) {
        if (showLoading) await this.ui.hideLoading();
        await this.ui.showError(msg);
        await this.handleExpiredSession();
        return null;
      }

      // silentError: el caller maneja el feedback. Relanzamos el error de negocio con
      // su mensaje (el catch del caller lo lee de error.message) en vez de tragarlo y
      // retornar null — así no se pierde la causa real (ej. "El turno ya está cerrado").
      if (silentError) throw error;

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
   * Detecta si el error es de transporte (la query no llegó al servidor) vs un error
   * de datos del servidor (RLS, validación, constraint). Se evalúa sobre el objeto error
   * original — más confiable que un string. Un fetch fallido no trae `code` de PostgREST.
   *
   * Público para los servicios/páginas que usan `.client` directo (sin pasar por `call()`):
   * en su propio catch deben silenciar el toast si fue por red (el banner global ya avisa):
   *   `if (this.supabase.esErrorDeTransporte(error) && !network.isConnected()) return;`
   */
  esErrorDeTransporte(error: any): boolean {
    const msg = (error?.message ?? '').toLowerCase();
    // PostgREST/Postgres adjuntan `code` a los errores de datos; su ausencia + mensaje
    // de fetch indica que la request no llegó al servidor (sin red).
    const sinCodeServidor = error?.code === undefined;
    return msg.includes('failed to fetch')
        || msg.includes('networkerror')
        || msg.includes('network request failed')
        || msg.includes('load failed')
        || (sinCodeServidor && (msg.includes('fetch') || msg === ''));
  }

  /**
   * True si el toast del error debe omitirse: el fallo es por falta de red estando offline,
   * y el banner global ya comunica el estado. Para usar en el catch de páginas/servicios que
   * llaman `.client` directo (no pasan por `call()`, que ya lo maneja internamente):
   *   `catch (e) { if (this.supabase.debeSilenciarErrorOffline(e)) return; this.ui.showError(...) }`
   */
  debeSilenciarErrorOffline(error: any): boolean {
    return !this.network.isConnected() && this.esErrorDeTransporte(error);
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
    if (nowMs - this.lastResumeRefreshAt < TIMING.resumeRefreshThrottleMs) {
      return;
    }

    // 3. ANTI-CONCURRENCIA — si ya hay un refresh en curso, no disparar otro
    if (this.resumeRefreshInFlight) {
      return;
    }

    this.lastResumeRefreshAt = nowMs;

    this.resumeRefreshInFlight = (async () => {
      const t0 = Date.now();
      try {
        const { data } = await this.client.auth.getSession();
        if (!data.session) return; // no hay sesión, nada que renovar

        // 2. SKIP TOKEN SANO — expires_at viene en segundos (Unix timestamp)
        const expiresAt = data.session.expires_at ?? 0;
        const nowSec = Math.floor(Date.now() / 1000);
        const secondsLeft = expiresAt - nowSec;

        // Si quedan más de jwtRefreshUmbralSegundos (5 min), el token está sano — no refrescar
        if (secondsLeft > TIMING.jwtRefreshUmbralSegundos) {
          this.logger.info('SupabaseService', `Token sano (${secondsLeft}s de vida) — sin refresh (getSession ${Date.now() - t0}ms)`);
          return;
        }

        // Quedan menos de 5 min → refrescar proactivamente
        const { error } = await this.client.auth.refreshSession();
        if (error) {
          this.logger.error('SupabaseService', 'Refresh on resume falló', error);
          // No redirigimos aquí — el listener de SIGNED_OUT lo hará si corresponde
        } else {
          this.logger.info('SupabaseService', `Sesión renovada (token tenía ${secondsLeft}s de vida) en ${Date.now() - t0}ms`);
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