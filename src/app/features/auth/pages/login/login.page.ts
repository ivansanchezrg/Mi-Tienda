import { Component, inject } from '@angular/core';
import {
  IonContent,
  IonButton,
  IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { storefront, logoGoogle } from 'ionicons/icons';
import { Network } from '@capacitor/network';
import { SupabaseService } from 'src/app/core/services/supabase.service';
import { UiService } from 'src/app/core/services/ui.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [
    IonContent,
    IonButton,
    IonIcon
  ]
})
export class LoginPage {

  private supabaseSvc = inject(SupabaseService);
  private ui = inject(UiService);

  iniciando = false;

  constructor() {
    addIcons({ storefront, logoGoogle });
  }

  async loginWithGoogle() {
    if (this.iniciando) return;

    const status = await Network.getStatus();
    if (!status.connected) {
      this.ui.showToast('Sin conexión a internet', 'warning');
      return;
    }

    this.iniciando = true;
    try {
      await this.supabaseSvc.signInWithGoogle();
    } catch (error: any) {
      this.ui.showError(error.message || 'Error al iniciar sesión');
    } finally {
      this.iniciando = false;
    }
  }
}
