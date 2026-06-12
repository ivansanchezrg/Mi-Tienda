import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonIcon,
  IonSkeletonText, IonSpinner,
  IonRefresher, IonRefresherContent,
  IonButtons, IonButton,
  IonAccordionGroup, IonAccordion, IonItem, IonLabel,
  ModalController, AlertController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  businessOutline, checkmarkCircle,
  chevronForwardOutline, shieldCheckmarkOutline,
  addOutline, ellipsisVertical,
  personOutline, personRemoveOutline,
  searchOutline, closeOutline, logInOutline,
  phonePortraitOutline, busOutline, extensionPuzzleOutline, archiveOutline
} from 'ionicons/icons';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';
import { AuthService } from '../../../auth/services/auth.service';
import { SupabaseService } from '@core/services/supabase.service';
import { LoggerService } from '@core/services/logger.service';
import { UiService } from '@core/services/ui.service';
import { ROUTES } from '@core/config/routes.config';
import { NegocioAdmin, PropietarioGrupo } from '../../models/negocio-admin.model';

@Component({
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.page.html',
  styleUrls: ['./admin-dashboard.page.scss'],
  standalone: true,
  imports: [
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonIcon,
    IonSkeletonText, IonSpinner,
    IonRefresher, IonRefresherContent,
    IonButtons, IonButton,
    IonAccordionGroup, IonAccordion, IonItem, IonLabel,
    EmptyStateComponent
  ]
})
export class AdminDashboardPage implements OnInit {
  private authService  = inject(AuthService);
  private supabase     = inject(SupabaseService);
  private ui           = inject(UiService);
  private logger       = inject(LoggerService);
  private router       = inject(Router);
  private modalCtrl    = inject(ModalController);
  private alertCtrl    = inject(AlertController);

  negocios: NegocioAdmin[] = [];
  loading   = false;
  cambiando: string | null = null;
  negocioActivoId: string | null = null;
  busqueda = '';

  constructor() {
    addIcons({
      businessOutline, checkmarkCircle, chevronForwardOutline, shieldCheckmarkOutline,
      addOutline, ellipsisVertical, personOutline, personRemoveOutline,
      searchOutline, closeOutline, logInOutline,
      phonePortraitOutline, busOutline, extensionPuzzleOutline, archiveOutline
    });
  }

  async ngOnInit() {
    const usuario = await this.authService.getUsuarioActual();
    this.negocioActivoId = usuario?.negocio_id ?? null;
    await this.cargar();
  }

  async cargar(silencioso = false) {
    if (!silencioso) this.loading = true;
    try {
      // Cargar negocios + propietarios + flags de módulos en una sola query
      const { data, error } = await this.supabase.client
        .from('negocios')
        .select(`
          id, nombre, slug, propietario_usuario_id, created_at,
          telefono, direccion, correo_electronico,
          ruc, razon_social, nombre_comercial,
          codigo_establecimiento, codigo_punto_emision, ambiente_sri, obligado_contabilidad,
          propietario:usuarios!propietario_usuario_id (nombre, email, activo),
          configuraciones (clave, valor)
        `)
        .order('created_at', { ascending: true });

      if (error) {
        this.logger.error('AdminDashboard', 'Error al cargar negocios', error);
        await this.ui.showError('Error al cargar los negocios.');
        return;
      }

      this.negocios = (data ?? []).map((n: any) => {
        const cfg: Record<string, string> = {};
        for (const c of (n.configuraciones ?? [])) cfg[c.clave] = c.valor;

        return {
          id:                     n.id,
          nombre:                 n.nombre,
          slug:                   n.slug,
          telefono:               n.telefono               ?? null,
          direccion:              n.direccion              ?? null,
          correo_electronico:     n.correo_electronico     ?? null,
          ruc:                    n.ruc                    ?? null,
          razon_social:           n.razon_social           ?? null,
          nombre_comercial:       n.nombre_comercial       ?? null,
          codigo_establecimiento: n.codigo_establecimiento ?? '001',
          codigo_punto_emision:   n.codigo_punto_emision   ?? '001',
          ambiente_sri:           n.ambiente_sri           ?? 1,
          obligado_contabilidad:  n.obligado_contabilidad  ?? false,
          propietario_usuario_id: n.propietario_usuario_id,
          created_at:             n.created_at,
          propietario_nombre:     n.propietario?.nombre  ?? 'Sin nombre',
          propietario_email:      n.propietario?.email   ?? '',
          propietario_activo:     n.propietario?.activo  ?? true,
          modulos: {
            celular:          cfg['recargas_celular_habilitada'] === 'true',
            bus:              cfg['recargas_bus_habilitada']     === 'true',
            varios:           cfg['caja_varios_activa']          === 'true',
            varios_monto:     parseFloat(cfg['caja_varios_transferencia_dia'] ?? '0') || 0,
            tipo_comprobante: (cfg['pos_tipo_comprobante'] as 'TICKET' | 'NOTA_VENTA' | 'FACTURA') ?? 'TICKET'
          }
        } satisfies NegocioAdmin;
      });
    } finally {
      this.loading = false;
    }
  }

  get propietariosAgrupados(): PropietarioGrupo[] {
    const q = this.busqueda.trim().toLowerCase();

    const negociosFiltrados = q
      ? this.negocios.filter(n =>
          n.nombre.toLowerCase().includes(q) ||
          n.propietario_nombre.toLowerCase().includes(q) ||
          n.propietario_email.toLowerCase().includes(q)
        )
      : this.negocios;

    const mapaGrupos = new Map<string, PropietarioGrupo>();

    for (const n of negociosFiltrados) {
      if (!mapaGrupos.has(n.propietario_usuario_id)) {
        mapaGrupos.set(n.propietario_usuario_id, {
          usuario_id: n.propietario_usuario_id,
          nombre:     n.propietario_nombre,
          email:      n.propietario_email,
          activo:     n.propietario_activo,
          negocios:   []
        });
      }
      mapaGrupos.get(n.propietario_usuario_id)!.negocios.push(n);
    }

    return Array.from(mapaGrupos.values());
  }

  limpiarBusqueda() {
    this.busqueda = '';
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

  crearNegocio() {
    this.router.navigate([ROUTES.crearNegocio.root], { queryParams: { context: 'admin' } });
  }

  async abrirOpciones(event: Event, negocio: NegocioAdmin) {
    event.stopPropagation();

    const groups: ModalOptionGroup[] = [
      {
        options: [
          {
            label:    'Ingresar al negocio',
            icon:     'log-in-outline',
            value:    'ingresar',
            subtitle: negocio.id === this.negocioActivoId
              ? 'Negocio activo actualmente'
              : 'Entrar y operar dentro de este negocio',
            color: negocio.id === this.negocioActivoId ? undefined : 'primary'
          },
          {
            label:    'Módulos',
            icon:     'extension-puzzle-outline',
            value:    'modulos',
            subtitle: this.resumenModulos(negocio)
          }
        ]
      },
      {
        options: [
          {
            label:    negocio.propietario_activo ? 'Suspender propietario' : 'Reactivar propietario',
            icon:     negocio.propietario_activo ? 'person-remove-outline' : 'person-outline',
            value:    'toggle-usuario',
            color:    negocio.propietario_activo ? 'danger' : undefined,
            subtitle: negocio.propietario_activo
              ? 'Bloquea al propietario en todos sus negocios'
              : 'Restaura el acceso del propietario a todos sus negocios'
          }
        ]
      }
    ];

    const modal = await this.modalCtrl.create({
      component: OptionsModalComponent,
      componentProps: { title: negocio.nombre, groups },
      cssClass: 'options-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (!data) return;

    if (data === 'ingresar')       await this.entrarNegocio(negocio);
    if (data === 'modulos')        await this.abrirModulos(negocio);
    if (data === 'toggle-usuario') await this.toggleUsuario(negocio);
  }

  async abrirModulos(negocio: NegocioAdmin) {
    const { ModulosNegocioModalComponent } = await import('../../components/modulos-negocio-modal/modulos-negocio-modal.component');

    const modal = await this.modalCtrl.create({
      component: ModulosNegocioModalComponent,
      componentProps: { negocio },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });

    await modal.present();
    const { data, role } = await modal.onDidDismiss<{ celular: boolean; bus: boolean; tipo_comprobante: 'TICKET' | 'NOTA_VENTA' | 'FACTURA' }>();

    if (role === 'confirm' && data) {
      // Varios ya no se gestiona desde aquí (potestad del admin del negocio) —
      // su valor leído de BD se conserva solo como dato informativo del resumen.
      negocio.modulos = {
        ...negocio.modulos,
        celular:          data.celular,
        bus:              data.bus,
        tipo_comprobante: data.tipo_comprobante ?? 'TICKET'
      };
    }
  }

  private resumenModulos(negocio: NegocioAdmin): string {
    const activos: string[] = [];
    if (negocio.modulos.celular) activos.push('Celular');
    if (negocio.modulos.bus)     activos.push('Bus');
    if (negocio.modulos.varios)  activos.push('Varios');
    return activos.length ? activos.join(' · ') : 'Sin módulos adicionales';
  }

  private async confirmar(header: string, message: string): Promise<boolean> {
    const alert = await this.alertCtrl.create({
      header,
      message,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Confirmar', role: 'confirm' }
      ]
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }

  private async toggleUsuario(negocio: NegocioAdmin) {
    const accion = negocio.propietario_activo ? 'suspender' : 'reactivar';
    const ok = await this.confirmar(
      `Confirmar ${accion} propietario`,
      negocio.propietario_activo
        ? `¿Suspender al propietario? No podrá entrar a ninguno de sus negocios.`
        : `¿Reactivar al propietario? Recuperará el acceso a todos sus negocios.`
    );
    if (!ok) return;

    const { error } = await this.supabase.client.rpc('fn_suspender_usuario', {
      p_usuario_id: negocio.propietario_usuario_id,
      p_activo:     !negocio.propietario_activo
    });

    if (error) {
      this.logger.error('AdminDashboard', `Error al ${accion} usuario`, error);
      await this.ui.showError(`No se pudo ${accion} al propietario.`);
      return;
    }

    negocio.propietario_activo = !negocio.propietario_activo;
    await this.ui.showSuccess(negocio.propietario_activo ? 'Propietario reactivado' : 'Propietario suspendido');
  }

  async salir() {
    await this.authService.logout();
  }
}
