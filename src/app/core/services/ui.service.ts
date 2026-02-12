import { Injectable, inject, signal } from '@angular/core';
import { LoadingController, ToastController } from '@ionic/angular/standalone';
// 1. IMPORTANTE: Importamos los iconos como objetos, no usamos strings
import { checkmarkCircleOutline, alertCircleOutline } from 'ionicons/icons';

@Injectable({ providedIn: 'root' })
export class UiService {
  private loadingCtrl = inject(LoadingController);
  private toastCtrl = inject(ToastController);

  // Control de visibilidad de tabs
  tabsVisible = signal(true);

  hideTabs() { this.tabsVisible.set(false); }
  showTabs() { this.tabsVisible.set(true); }

  private loadingCount = 0;
  private loadingElement: HTMLIonLoadingElement | null = null;

  /** Muestra Loading (Conteo inteligente) */
  async showLoading(msg = 'Procesando...') {
    this.loadingCount++;
    if (this.loadingCount === 1) {
      this.loadingElement = await this.loadingCtrl.create({
        message: msg,
        spinner: 'crescent',
        duration: 15000 // Timeout de seguridad
      });
      await this.loadingElement.present();
    }
  }

  /** Oculta Loading (Conteo inteligente) */
  async hideLoading() {
    this.loadingCount--;
    if (this.loadingCount <= 0) {
      this.loadingCount = 0;
      if (this.loadingElement) {
        await this.loadingElement.dismiss();
        this.loadingElement = null;
      }
    }
  }

  /** Muestra Toast de Error con mensaje amigable */
  async showError(message: string) {
    const toast = await this.toastCtrl.create({
      message: this.formatErrorMessage(message),
      duration: 5000,
      color: 'danger',
      position: 'top',
      icon: alertCircleOutline,
      buttons: [{ text: 'OK', role: 'cancel' }]
    });
    await toast.present();
  }

  /** Convierte errores técnicos a mensajes amigables */
  private formatErrorMessage(message: string): string {
    const lower = message.toLowerCase();

    // Errores de red
    if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('net::')) {
      return 'Error de conexión. Verifica tu internet.';
    }
    if (lower.includes('timeout')) {
      return 'La conexión tardó demasiado. Intenta de nuevo.';
    }

    // Errores de autenticación
    if (lower.includes('jwt') && (lower.includes('expired') || lower.includes('invalid'))) {
      return 'Sesión expirada. Inicia sesión nuevamente.';
    }
    if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
      return 'Credenciales inválidas.';
    }
    if (lower.includes('email not confirmed')) {
      return 'Debes confirmar tu email primero.';
    }
    if (lower.includes('user not found')) {
      return 'Usuario no encontrado.';
    }

    // Errores de permisos
    if (lower.includes('permission denied') || lower.includes('not authorized')) {
      return 'No tienes permisos para esta acción.';
    }
    if (lower.includes('row level security')) {
      return 'Acceso denegado.';
    }

    // Errores de base de datos
    if (lower.includes('could not find') && lower.includes('table')) {
      return 'Tabla no encontrada en la base de datos.';
    }
    if (lower.includes('schema cache')) {
      return 'Error en la estructura de la base de datos.';
    }
    if (lower.includes('duplicate') || lower.includes('unique constraint')) {
      return 'Este registro ya existe.';
    }
    if (lower.includes('not found') || lower.includes('no rows')) {
      return 'Registro no encontrado.';
    }

    // Si no coincide con ninguno, retornar el original
    return message;
  }

  /** Muestra Toast genérico con color configurable */
  async showToast(message: string, color: string = 'primary') {
    const icon = color === 'success' ? checkmarkCircleOutline
               : color === 'danger' ? alertCircleOutline
               : undefined;
    const toast = await this.toastCtrl.create({
      message,
      duration: 5000,
      color,
      position: 'top',
      ...(icon && { icon }),
      ...(color === 'danger' && { buttons: [{ text: 'OK', role: 'cancel' }] })
    });
    await toast.present();
  }

  /** Muestra Toast de Éxito */
  async showSuccess(message: string) {
    const toast = await this.toastCtrl.create({
      message: message,
      duration: 5000,
      color: 'success',
      position: 'top',
      icon: checkmarkCircleOutline
    });
    await toast.present();
  }
}