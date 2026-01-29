import { Injectable, inject } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from 'src/environments/environment';
import { UiService } from './ui.service';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';


@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private ui = inject(UiService);
  
  // Cliente público para usar en selects simples si quieres
  public client: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseKey);

  // Variable crítica para Android (según tu MD)  >>>> NUEVO
  public pendingDeepLinkUrl: string | null = null;


  constructor() {}

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
      
      await this.ui.showError(msg);
      return null; // Retornamos null para que la UI sepa que falló

    } finally {
      // 6. Siempre cerrar el loading
      await this.ui.hideLoading();
    }
  }
}