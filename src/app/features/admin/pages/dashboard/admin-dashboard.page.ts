import { Component, OnInit, inject } from '@angular/core';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonIcon,
  IonSkeletonText, IonSpinner,
  IonRefresher, IonRefresherContent,
  IonButtons, IonButton
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  businessOutline, checkmarkCircle,
  chevronForwardOutline, shieldCheckmarkOutline
} from 'ionicons/icons';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { AuthService } from '../../../auth/services/auth.service';
import { SupabaseService } from '@core/services/supabase.service';
import { LoggerService } from '@core/services/logger.service';
import { UiService } from '@core/services/ui.service';

interface NegocioAdmin {
  id: string;
  nombre: string;
  slug: string;
  activo: boolean;
  created_at: string;
}

@Component({
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.page.html',
  styleUrls: ['./admin-dashboard.page.scss'],
  standalone: true,
  imports: [
    IonHeader, IonToolbar, IonTitle, IonContent, IonIcon,
    IonSkeletonText, IonSpinner,
    IonRefresher, IonRefresherContent,
    IonButtons, IonButton,
    EmptyStateComponent
  ]
})
export class AdminDashboardPage implements OnInit {
  private authService = inject(AuthService);
  private supabase    = inject(SupabaseService);
  private ui          = inject(UiService);
  private logger      = inject(LoggerService);

  negocios: NegocioAdmin[] = [];
  loading    = false;
  cambiando: string | null = null;
  negocioActivoId: string | null = null;

  constructor() {
    addIcons({ businessOutline, checkmarkCircle, chevronForwardOutline, shieldCheckmarkOutline });
  }

  async ngOnInit() {
    const usuario = await this.authService.getUsuarioActual();
    this.negocioActivoId = usuario?.negocio_id ?? null;
    await this.cargar();
  }

  async cargar(silencioso = false) {
    if (!silencioso) this.loading = true;
    try {
      const { data, error } = await this.supabase.client
        .from('negocios')
        .select('id, nombre, slug, activo, created_at')
        .order('created_at', { ascending: true });

      if (error) {
        this.logger.error('AdminDashboard', 'Error al cargar negocios', error);
        await this.ui.showError('Error al cargar los negocios.');
        return;
      }

      this.negocios = data ?? [];
    } finally {
      this.loading = false;
    }
  }

  async handleRefresh(event: CustomEvent) {
    await this.cargar(true);
    (event.target as HTMLIonRefresherElement).complete();
  }

  async entrarNegocio(negocio: NegocioAdmin) {
    if (this.cambiando || negocio.id === this.negocioActivoId) return;

    this.cambiando = negocio.id;
    await this.ui.showLoading(`Entrando a ${negocio.nombre}...`);
    try {
      await this.authService.cambiarNegocio(negocio.id, negocio.nombre);
    } finally {
      await this.ui.hideLoading();
      this.cambiando = null;
    }
  }

  async salir() {
    await this.authService.logout();
  }
}
