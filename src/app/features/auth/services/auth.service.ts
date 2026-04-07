import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular/standalone';
import { Preferences } from '@capacitor/preferences';
import { SupabaseService } from '@core/services/supabase.service';
import { UiService } from '@core/services/ui.service';
import { LoggerService } from '@core/services/logger.service';
import { environment } from '../../../../environments/environment';
import { UsuarioActual } from '../models/usuario_actual.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private supabase = inject(SupabaseService);
  private router = inject(Router);
  private ui = inject(UiService);
  private alertCtrl = inject(AlertController);
  private logger = inject(LoggerService);

  // Key de storage de Supabase: sb-{projectRef}-auth-token
  private readonly STORAGE_KEY: string;
  private readonly USUARIO_KEY = 'usuario_actual';

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
   * Valida que el email del usuario logueado exista en la tabla usuarios y esté activo.
   * - Si no existe → auto-registra con activo: false y redirige a /auth/pending.
   * - Si existe pero activo: false → redirige a /auth/pending.
   * - Si existe y activo: true → guarda en Preferences y retorna true.
   */
  async validarUsuario(): Promise<boolean> {
    const user = await this.getUser();
    if (!user?.email) {
      this.logger.warn('AuthService', 'validarUsuario: no hay usuario o email en sesión');
      await this.forceLogout();
      return false;
    }

    const { data, error } = await this.supabase.client
      .from('usuarios')
      .select('id, nombre, usuario, activo, rol')
      .eq('usuario', user.email)
      .maybeSingle();

    if (error) {
      this.logger.error('AuthService', 'Error al consultar usuario en BD', error);
      await this.ui.showError('Error al verificar tu cuenta. Intentá de nuevo.');
      await this.forceLogout();
      return false;
    }

    // Usuario no existe → auto-registro con activo: false
    if (!data) {
      this.logger.info('AuthService', `Auto-registro: ${user.email}`);
      const nombre = user.user_metadata?.['full_name'] || user.user_metadata?.['name'] || user.email.split('@')[0];

      const { error: insertError } = await this.supabase.client
        .from('usuarios')
        .insert({ nombre, usuario: user.email, rol: 'EMPLEADO', activo: false });

      if (insertError) {
        this.logger.error('AuthService', 'Error al auto-registrar usuario', insertError);
        await this.ui.showError('Error al registrar tu cuenta. Intentá de nuevo.');
        await this.forceLogout();
        return false;
      }

      this.router.navigate(['/auth/pending'], { queryParams: { estado: 'nuevo' }, replaceUrl: true });
      return false;
    }

    // Usuario existe pero inactivo → pantalla de pendiente
    if (!data.activo) {
      this.logger.warn('AuthService', `validarUsuario: usuario ${user.email} inactivo`);
      await this.saveUsuarioActual(data);
      this.router.navigate(['/auth/pending'], { replaceUrl: true });
      return false;
    }

    this.logger.info('AuthService', `Usuario validado: ${data.nombre} (${data.rol})`);
    await this.saveUsuarioActual(data);
    return true;
  }

  /** Cierra sesión sin mostrar loading (uso interno) */
  private async forceLogout() {
    await this.supabase.handleExpiredSession();
  }

  /** Cierra sesión directo, sin confirmación (para pantallas pre-app como pending) */
  async logoutSilent() {
    await this.executeLogout();
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
    this.logger.info('AuthService', 'Logout manual confirmado por el usuario');
    await this.ui.showLoading();
    await this.supabase.handleExpiredSession();
    await this.ui.hideLoading();
  }

  // ==========================================
  // MÉTODOS DE USUARIO ACTUAL (Preferences)
  // ==========================================

  /**
   * Obtiene el usuario actual desde Preferences (lectura local, muy rápida).
   * No hace consultas a la BD.
   * Retorna null si no hay usuario guardado.
   */
  async getUsuarioActual(): Promise<UsuarioActual | null> {
    try {
      const { value } = await Preferences.get({ key: this.USUARIO_KEY });
      if (!value) return null;
      return JSON.parse(value) as UsuarioActual;
    } catch {
      return null;
    }
  }

  /**
   * Guarda los datos del usuario en Preferences.
   * Se llama automáticamente después de validar el login.
   */
  private async saveUsuarioActual(usuario: UsuarioActual): Promise<void> {
    await Preferences.set({
      key: this.USUARIO_KEY,
      value: JSON.stringify(usuario)
    });
  }

}
