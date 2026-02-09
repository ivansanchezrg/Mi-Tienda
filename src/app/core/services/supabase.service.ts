import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from 'src/environments/environment';
import { UiService } from './ui.service';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';


@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private ui = inject(UiService);
  private router = inject(Router);

  public client: SupabaseClient;

  // Variable crítica para Android (según tu MD)  >>>> NUEVO
  public pendingDeepLinkUrl: string | null = null;

  // Key de storage de Supabase
  private readonly STORAGE_KEY: string;

  constructor() {
    const projectRef = environment.supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || '';
    this.STORAGE_KEY = `sb-${projectRef}-auth-token`;

    // Inicializar Supabase con configuración para evitar errores de LockManager
    this.client = createClient(environment.supabaseUrl, environment.supabaseKey, {
      auth: {
        storageKey: this.STORAGE_KEY,
        storage: window.localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        // Desactiva LockManager (no necesario en Capacitor - single window)
        lock: async (name, acquireTimeout, fn) => {
          return await fn();
        }
      }
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
   */
  async call<T>(
    promise: PromiseLike<any>,
    successMessage?: string
  ): Promise<T | null> { // Retorna null si hay error

    await this.ui.showLoading();
    let loadingClosed = false;

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
      console.error('Supabase Error:', error);

      // Extraemos el mensaje legible del error de Supabase
      const msg = error.message || error.error_description || 'Ocurrió un error inesperado';

      // Detectar JWT expirado y hacer logout automático
      if (this.isJWTExpiredError(msg)) {
        // Mostrar error primero
        await this.ui.showError(msg);

        // Cerrar loading
        await this.ui.hideLoading();
        loadingClosed = true;

        // Dar tiempo para que el usuario vea el mensaje (1.5 segundos)
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Limpiar sesión y redirigir
        await this.handleExpiredSession();

        return null;
      }

      await this.ui.showError(msg);
      return null; // Retornamos null para que la UI sepa que falló

    } finally {
      // 6. Cerrar el loading solo si no se cerró antes
      if (!loadingClosed) {
        await this.ui.hideLoading();
      }
    }
  }

  /**
   * Detecta si el error es de JWT expirado o inválido
   */
  private isJWTExpiredError(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes('jwt') && (lower.includes('expired') || lower.includes('invalid'));
  }

  /**
   * Maneja la sesión expirada: limpia sesión y redirige al login
   */
  private async handleExpiredSession() {
    // Limpiar sesión (sin await para evitar que falle si no hay red)
    this.client.auth.signOut().catch(() => {
      // Ignorar errores de signOut (puede fallar sin internet)
    });

    // Limpiar storage local
    localStorage.removeItem(this.STORAGE_KEY);

    // Redirigir al login
    await this.router.navigate(['/auth/login'], { replaceUrl: true });
  }
}