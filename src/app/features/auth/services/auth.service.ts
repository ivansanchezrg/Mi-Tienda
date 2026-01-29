import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../../../core/services/supabase.service';
import { UiService } from '../../../core/services/ui.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private router = inject(Router);
  private supabase = inject(SupabaseService);
  private ui = inject(UiService);

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
    this.router.navigate(['/auth/login'], { replaceUrl: true });
  }

  async logout() {
    await this.ui.showLoading();
    const { error } = await this.supabase.client.auth.signOut();
    await this.ui.hideLoading();

    if (error) {
      await this.ui.showError('Error al cerrar sesión');
      return;
    }

    this.router.navigate(['/auth/login'], { replaceUrl: true });
  }
}
