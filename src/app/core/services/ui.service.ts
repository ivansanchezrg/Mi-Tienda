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

  /** Muestra Toast de Error automáticamente */
  async showError(message: string) {
    const toast = await this.toastCtrl.create({
      message: message,
      duration: 3000,
      color: 'danger', // Rojo para errores
      position: 'bottom',
      // 2. CORREGIDO: Pasamos la variable del icono directamente
      icon: alertCircleOutline, 
      buttons: [{ text: 'OK', role: 'cancel' }]
    });
    await toast.present();
  }

  /** Muestra Toast genérico con color configurable */
  async showToast(message: string, color: string = 'primary') {
    const icon = color === 'success' ? checkmarkCircleOutline
               : color === 'danger' ? alertCircleOutline
               : undefined;
    const toast = await this.toastCtrl.create({
      message,
      duration: color === 'danger' ? 3000 : 2000,
      color,
      position: 'bottom',
      ...(icon && { icon }),
      ...(color === 'danger' && { buttons: [{ text: 'OK', role: 'cancel' }] })
    });
    await toast.present();
  }

  /** Muestra Toast de Éxito (Opcional) */
  async showSuccess(message: string) {
    const toast = await this.toastCtrl.create({
      message: message,
      duration: 2000,
      color: 'success',
      position: 'bottom',
      // 3. CORREGIDO: Pasamos la variable del icono directamente
      icon: checkmarkCircleOutline 
    });
    await toast.present();
  }
}