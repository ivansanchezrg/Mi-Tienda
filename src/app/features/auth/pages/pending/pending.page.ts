import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
  IonContent,
  IonButton,
  IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { refreshOutline, logOutOutline, banOutline } from 'ionicons/icons';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '@core/services/supabase.service';
import { UiService } from '@core/services/ui.service';

type Motivo = 'usuario' | 'membresia' | null;

@Component({
  selector: 'app-pending',
  templateUrl: './pending.page.html',
  styleUrls: ['./pending.page.scss'],
  standalone: true,
  imports: [IonContent, IonButton, IonIcon]
})
export class PendingPage implements OnInit {
  private authService = inject(AuthService);
  private supabase    = inject(SupabaseService);
  private ui          = inject(UiService);
  private route       = inject(ActivatedRoute);

  verificando = false;
  motivo: Motivo = null;

  constructor() {
    addIcons({ refreshOutline, logOutOutline, banOutline });
  }

  ngOnInit() {
    this.motivo = (this.route.snapshot.queryParamMap.get('motivo') ?? null) as Motivo;
  }

  get icono(): string {
    return 'ban-outline';
  }

  get titulo(): string {
    if (this.motivo === 'membresia') return 'Acceso removido';
    return 'Cuenta suspendida';
  }

  get mensaje(): string {
    if (this.motivo === 'membresia') {
      return 'Tu acceso a este negocio fue removido. Contactá al administrador si creés que es un error.';
    }
    return 'Tu cuenta fue suspendida por el administrador. Contactalo para que te reactive.';
  }

  async reintentar() {
    if (this.verificando) return;
    this.verificando = true;

    try {
      const user = await this.authService.getUser();
      if (!user?.email) {
        await this.authService.logoutSilent();
        return;
      }

      const { data } = await this.supabase.client
        .from('usuarios')
        .select('activo')
        .eq('email', user.email)
        .maybeSingle();

      if (data?.activo === false) {
        await this.ui.showToast('Tu cuenta sigue suspendida. Contactá al administrador.', 'warning');
        return;
      }

      await this.authService.validarUsuario();
    } finally {
      this.verificando = false;
    }
  }

  async cerrarSesion() {
    await this.authService.logoutSilent();
  }
}
