import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonCard, IonCardContent, IonButton, IonIcon,
  IonSpinner, IonBadge, IonButtons
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { businessOutline, chevronForwardOutline, logOutOutline } from 'ionicons/icons';
import { AuthService, NegocioDisponible } from '../../services/auth.service';
import { SupabaseService } from '@core/services/supabase.service';
import { UiService } from '@core/services/ui.service';
import { ROUTES } from '@core/config/routes.config';

@Component({
  selector: 'app-selector-negocio',
  templateUrl: './seleccionar-negocio.page.html',
  styleUrls: ['./seleccionar-negocio.page.scss'],
  standalone: true,
  imports: [
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonCard, IonCardContent, IonButton, IonIcon,
    IonSpinner, IonBadge, IonButtons
  ]
})
export class SelectorNegocioPage implements OnInit {
  private authService = inject(AuthService);
  private supabase    = inject(SupabaseService);
  private router      = inject(Router);
  private ui          = inject(UiService);

  negocios: NegocioDisponible[] = [];
  activando: string | null = null;
  loading = false;

  constructor() {
    addIcons({ businessOutline, chevronForwardOutline, logOutOutline });
  }

  async ngOnInit() {
    this.negocios = this.authService.negociosDisponibles;

    // Recarga de página: el array en memoria se perdió.
    // Cargar directamente de BD sin pasar por validarUsuario() (evita bucle).
    if (this.negocios.length === 0) {
      await this.cargarNegociosDesdeBD();
    }
  }

  private async cargarNegociosDesdeBD() {
    this.loading = true;
    try {
      const user = await this.authService.getUser();
      if (!user?.email) {
        this.router.navigate([ROUTES.auth.login], { replaceUrl: true });
        return;
      }

      // Obtener usuario_id
      const { data: userData } = await this.supabase.client
        .from('usuarios')
        .select('id, es_superadmin')
        .eq('email', user.email)
        .maybeSingle();

      if (!userData) {
        this.router.navigate([ROUTES.auth.login], { replaceUrl: true });
        return;
      }

      // Abrir canal Realtime (cambios de nombre, eliminación) mientras está en esta pantalla
      if (!userData.es_superadmin) {
        this.authService.iniciarRealtimeUsuario(userData.id);
      }

      // Obtener membresías activas con estado del negocio
      const { data: membresias } = await this.supabase.client
        .from('usuario_negocios')
        .select('negocio_id, rol, negocio:negocios(nombre)')
        .eq('usuario_id', userData.id)
        .eq('activo', true);

      this.negocios = (membresias || []).map((m: any) => ({
        negocio_id:     m.negocio_id,
        negocio_nombre: m.negocio?.nombre ?? 'Sin nombre',
        rol:            m.rol as 'ADMIN' | 'EMPLEADO'
      }));

      // Sincronizar con AuthService para que activarNegocio() funcione
      this.authService.negociosDisponibles = this.negocios;

      if (this.negocios.length === 0) {
        this.router.navigate([ROUTES.onboarding.negocio], { replaceUrl: true });
      } else if (this.negocios.length === 1) {
        await this.authService.validarUsuario();
      }
    } finally {
      this.loading = false;
    }
  }

  async seleccionar(negocio: NegocioDisponible) {
    if (this.activando) return;
    this.activando = negocio.negocio_id;

    try {
      await this.authService.activarNegocio(negocio);
    } catch (err) {
      this.activando = null;
      await this.ui.showError('Error al activar el negocio. Intentá de nuevo.');
    }
  }

  async salir() {
    await this.authService.logoutSilent();
  }

  rolLegible(rol: string): string {
    return rol === 'ADMIN' ? 'Administrador' : 'Empleado';
  }
}
