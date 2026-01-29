import { Component, inject } from '@angular/core';
import {
  IonContent,
  IonButton,
  IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { storefront, logoGoogle } from 'ionicons/icons';
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

  constructor() {
    addIcons({ storefront, logoGoogle });
  }

  async loginWithGoogle() {
    try {
      // No mostramos loading infinito porque la app se irá a segundo plano (browser)
      await this.supabaseSvc.signInWithGoogle();
    } catch (error: any) {
      this.ui.showError('Error iniciando con Google: ' + error.message);
    }
  }
}
