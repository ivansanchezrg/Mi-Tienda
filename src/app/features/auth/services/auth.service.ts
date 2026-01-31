import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular/standalone';
import { SupabaseService } from '../../../core/services/supabase.service';
import { UiService } from '../../../core/services/ui.service';
import { environment } from '../../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private router = inject(Router);
  private supabase = inject(SupabaseService);
  private ui = inject(UiService);
  private alertCtrl = inject(AlertController);

  // Key de storage de Supabase: sb-{projectRef}-auth-token
  private readonly STORAGE_KEY: string;

  constructor() {
    const projectRef = environment.supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || '';
    this.STORAGE_KEY = `sb-${projectRef}-auth-token`;
  }

  /**
   * Verifica si hay sesión guardada localmente (sin llamada de red).
   * Útil para el guard cuando no hay internet.
   */
  hasLocalSession(): boolean {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return false;

      const parsed = JSON.parse(stored);
      return !!parsed?.access_token;
    } catch {
      return false;
    }
  }

  /** Retorna la sesión actual o null */
  async getSession() {
    const { data } = await this.supabase.client.auth.getSession();
    return data.session;
  }

  /** Retorna el usuario actual o null */
  async getUser() {
    const session = await this.getSession();
    return session?.user ?? null;
  }

  /**
   * Valida que el email del usuario logueado exista en la tabla empleados y esté activo.
   * Retorna true si es válido, false si no.
   * Si no es válido, cierra sesión automáticamente.
   */
  async validateEmployee(): Promise<boolean> {
    const user = await this.getUser();
    if (!user?.email) {
      await this.forceLogout();
      return false;
    }

    const { data, error } = await this.supabase.client
      .from('empleados')
      .select('id, activo')
      .eq('usuario', user.email)
      .single();

    if (error || !data) {
      await this.ui.showError('No tienes acceso. Contacta al administrador.');
      await this.forceLogout();
      return false;
    }

    if (!data.activo) {
      await this.ui.showError('Tu cuenta está desactivada. Contacta al administrador.');
      await this.forceLogout();
      return false;
    }

    return true;
  }

  /** Cierra sesión sin mostrar loading (uso interno) */
  private async forceLogout() {
    await this.supabase.client.auth.signOut();
    localStorage.removeItem(this.STORAGE_KEY);
    this.router.navigate(['/auth/login'], { replaceUrl: true });
  }

  /** Muestra confirmación y cierra sesión si el usuario acepta */
  async logout() {
    const alert = await this.alertCtrl.create({
      header: 'Cerrar Sesión',
      message: '¿Estás seguro de que deseas cerrar sesión?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Cerrar Sesión', role: 'confirm' }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role === 'confirm') {
      await this.executeLogout();
    }
  }

  /** Ejecuta el cierre de sesión */
  private async executeLogout() {
    await this.ui.showLoading();

    // signOut puede fallar sin internet, pero igual limpia la sesión local
    await this.supabase.client.auth.signOut();

    // Forzar limpieza de sesión local por si signOut falla sin internet
    localStorage.removeItem(this.STORAGE_KEY);

    await this.ui.hideLoading();

    this.router.navigate(['/auth/login'], { replaceUrl: true });
  }
}
