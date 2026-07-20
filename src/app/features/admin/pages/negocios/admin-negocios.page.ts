import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonIcon,
  IonSkeletonText, IonSpinner,
  IonRefresher, IonRefresherContent,
  IonButtons, IonButton,
  IonAccordionGroup, IonAccordion,
  ModalController, AlertController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  businessOutline, checkmarkCircle,
  shieldCheckmarkOutline,
  addOutline, ellipsisVertical,
  personOutline, banOutline, checkmarkCircleOutline,
  searchOutline, closeOutline, logInOutline,
  phonePortraitOutline, busOutline, extensionPuzzleOutline, archiveOutline,
  cardOutline, chevronDownOutline,
  logoWhatsapp, trashOutline, closeCircleOutline, alertCircleOutline, refreshOutline
} from 'ionicons/icons';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';
import { RegistrarPagoModalComponent } from '../../components/registrar-pago-modal/registrar-pago-modal.component';
import { AdminTabsComponent } from '../../components/admin-tabs/admin-tabs.component';
import { AuthService } from '../../../auth/services/auth.service';
import { SupabaseService } from '@core/services/supabase.service';
import { SuscripcionService } from '@core/services/suscripcion.service';
import { LoggerService } from '@core/services/logger.service';
import { UiService } from '@core/services/ui.service';
import { WhatsAppService } from '@core/services/whatsapp.service';
import { ROUTES } from '@core/config/routes.config';
import { NegocioAdmin, PropietarioGrupo, SuscripcionNegocio } from '../../models/negocio-admin.model';
import { SuscripcionAdmin, NegocioPendientePurga } from '../../../suscripcion/models/suscripcion.model';

@Component({
  selector: 'app-admin-negocios',
  templateUrl: './admin-negocios.page.html',
  styleUrls: ['./admin-negocios.page.scss'],
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonIcon,
    IonSkeletonText, IonSpinner,
    IonRefresher, IonRefresherContent,
    IonButtons, IonButton,
    IonAccordionGroup, IonAccordion,
    EmptyStateComponent, AdminTabsComponent
  ]
})
export class AdminNegociosPage implements OnInit {
  private authService  = inject(AuthService);
  private supabase     = inject(SupabaseService);
  private suscripcion  = inject(SuscripcionService);
  private ui           = inject(UiService);
  private logger       = inject(LoggerService);
  private whatsapp     = inject(WhatsAppService);
  private router       = inject(Router);
  private modalCtrl    = inject(ModalController);
  private alertCtrl    = inject(AlertController);

  negocios: NegocioAdmin[] = [];
  loading   = false;
  cambiando: string | null = null;
  negocioActivoId: string | null = null;
  busqueda = '';
  acordeonesAbiertos = new Set<string>();

  // Purga automática de negocios vencidos (docs/suscripcion/SUSCRIPCION-README.md,
  // sección "Purga automática de negocios vencidos").
  // Indexado por propietario_id — todos sus negocios comparten estas fechas.
  private purgaPorPropietario = new Map<string, NegocioPendientePurga>();
  detectandoPurga = false;

  onAccordionChange(event: CustomEvent, usuarioId: string) {
    const valores: string[] = event.detail.value ?? [];
    if (valores.includes(usuarioId)) {
      this.acordeonesAbiertos.add(usuarioId);
    } else {
      this.acordeonesAbiertos.delete(usuarioId);
    }
  }

  constructor() {
    addIcons({
      businessOutline, checkmarkCircle, shieldCheckmarkOutline,
      addOutline, ellipsisVertical, personOutline, banOutline, checkmarkCircleOutline,
      searchOutline, closeOutline, logInOutline,
      phonePortraitOutline, busOutline, extensionPuzzleOutline, archiveOutline,
      cardOutline, chevronDownOutline,
      logoWhatsapp, trashOutline, closeCircleOutline, alertCircleOutline, refreshOutline
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
      // Negocios (+ propietarios + módulos), suscripciones y purga pendiente en
      // paralelo — 1 round-trip por fuente.
      const [respNegocios, suscripciones, pendientesPurga] = await Promise.all([
        this.supabase.client
          .from('negocios')
          .select(`
            id, nombre, slug, propietario_usuario_id, created_at,
            telefono, direccion, correo_electronico,
            ruc, razon_social, nombre_comercial,
            codigo_establecimiento, codigo_punto_emision, ambiente_sri, obligado_contabilidad,
            propietario:usuarios!propietario_usuario_id (nombre, email),
            configuraciones (clave, valor)
          `)
          .order('created_at', { ascending: true }),
        this.suscripcion.listarSuscripcionesAdmin(),
        this.suscripcion.listarNegociosPendientesPurga(),
      ]);

      this.purgaPorPropietario = new Map(pendientesPurga.map(p => [p.propietario_id, p]));

      const { data, error } = respNegocios;

      if (error) {
        this.logger.error('AdminNegocios', 'Error al cargar negocios', error);
        await this.ui.showError('Error al cargar los negocios.');
        return;
      }

      // Índice de suscripción vigente por negocio_id, para mergear en O(1).
      const suscPorNegocio = new Map<string, SuscripcionAdmin>(
        suscripciones.map(s => [s.negocio_id, s])
      );

      this.negocios = (data ?? []).map((n: any) => {
        const cfg: Record<string, string> = {};
        for (const c of (n.configuraciones ?? [])) cfg[c.clave] = c.valor;

        const s = suscPorNegocio.get(n.id);
        const suscripcion: SuscripcionNegocio | null = s
          ? {
              estado:         s.estado,
              plan_codigo:    s.plan_codigo,
              plan_nombre:    s.plan_nombre,
              precio:         s.precio,
              periodo:        s.periodo,
              vence_el:       s.vence_el,
              dias_restantes: s.dias_restantes,
            }
          : null;

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
          modulos: {
            celular:          cfg['recargas_celular_habilitada'] === 'true',
            bus:              cfg['recargas_bus_habilitada']     === 'true',
            varios:           cfg['caja_varios_activa']          === 'true',
            varios_monto:     parseFloat(cfg['caja_varios_transferencia_dia'] ?? '0') || 0,
            tipo_comprobante: (cfg['pos_tipo_comprobante'] as 'TICKET' | 'NOTA_VENTA' | 'FACTURA') ?? 'TICKET'
          },
          suscripcion,
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
          suspendido: false,   // se deriva abajo, una vez agrupados todos sus negocios
          negocios:   []
        });
      }
      mapaGrupos.get(n.propietario_usuario_id)!.negocios.push(n);
    }

    // Derivar "suspendido": el propietario está suspendido por cobro si tiene
    // negocios y TODOS están en estado SUSPENDIDA (la suspensión es por dueño).
    const grupos = Array.from(mapaGrupos.values());
    for (const g of grupos) {
      g.suspendido = g.negocios.length > 0
        && g.negocios.every(n => n.suscripcion?.estado === 'SUSPENDIDA');

      const p = this.purgaPorPropietario.get(g.usuario_id);
      g.purga = p
        ? {
            telefono_contacto:    p.telefono_contacto,
            purga_programada_el:  p.purga_programada_el,
            dias_restantes_purga: p.dias_restantes_purga,
            puede_purgar_ya:      p.puede_purgar_ya,
          }
        : undefined;
    }
    return grupos;
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

  /**
   * Menú de acciones de un NEGOCIO concreto: ingresar y módulos.
   * NI la suspensión NI el pago viven aquí: ambos se gestionan por propietario, no
   * por sucursal (la suscripción se paga por dueño). Esas acciones están en el menú
   * del propietario (abrirOpcionesPropietario).
   */
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

    if (data === 'ingresar') await this.entrarNegocio(negocio);
    if (data === 'modulos')  await this.abrirModulos(negocio);
  }

  /**
   * Menú de acciones del grupo de un dueño. Suspender bloquea por cobro la suscripción
   * de TODOS sus negocios de una sola vez (la suscripción se paga por propietario, no
   * por sucursal). Cada sucursal queda mostrando la pantalla de cobro. El label y los
   * textos hablan de "negocio(s)" — el dueño ya está en el título del modal — y se
   * adaptan a singular/plural según cuántos negocios tenga.
   *
   * Reactivar se mantiene como acción manual para corregir una suspensión por error
   * (la reactivación "normal" del cliente ocurre al registrar su pago, no aquí).
   */
  async abrirOpcionesPropietario(event: Event, grupo: PropietarioGrupo) {
    event.stopPropagation();

    const uno = grupo.negocios.length === 1;
    const negocioPalabra = uno ? 'negocio' : 'negocios';

    const groups: ModalOptionGroup[] = [
      {
        options: [
          {
            label:    'Registrar pago',
            icon:     'card-outline',
            value:    'pago',
            subtitle: this.resumenSuscripcionGrupo(grupo)
          }
        ]
      },
      {
        options: [
          {
            label:    grupo.suspendido ? `Reactivar ${negocioPalabra}` : `Suspender ${negocioPalabra}`,
            icon:     grupo.suspendido ? 'checkmark-circle-outline' : 'ban-outline',
            value:    'toggle-suspension',
            color:    grupo.suspendido ? undefined : 'danger',
            subtitle: grupo.suspendido
              ? (uno ? 'Reactiva su único negocio' : `Reactiva los ${grupo.negocios.length} negocios de este dueño`)
              : (uno ? 'Bloquea por cobro su único negocio' : `Bloquea por cobro los ${grupo.negocios.length} negocios de este dueño`)
          }
        ]
      }
    ];

    // Acciones de purga (docs/suscripcion/SUSCRIPCION-README.md, sección "Purga
    // automática de negocios vencidos") — solo si el propietario está marcado
    // para purga. Grupo aparte para separarlo visualmente de la gestión normal de cobro.
    if (grupo.purga) {
      groups.push({
        options: [
          {
            label:    'Avisar por WhatsApp',
            icon:     'logo-whatsapp',
            value:    'avisar-whatsapp',
            subtitle: grupo.purga.telefono_contacto
              ? `Quedan ${grupo.purga.dias_restantes_purga} día(s) para el borrado`
              : 'Sin teléfono de contacto configurado'
          },
          {
            label:    'Purgar ahora',
            icon:     'trash-outline',
            value:    'purgar',
            color:    'danger',
            subtitle: grupo.purga.puede_purgar_ya
              ? `Borra ${negocioPalabra} y todos sus datos — no se puede deshacer`
              : `Disponible en ${grupo.purga.dias_restantes_purga} día(s)`
          },
          {
            label:    'Cancelar purga',
            icon:     'close-circle-outline',
            value:    'cancelar-purga',
            subtitle: 'Excepción de soporte — sin registrar un pago real'
          }
        ]
      });
    }

    const modal = await this.modalCtrl.create({
      component: OptionsModalComponent,
      componentProps: { title: grupo.nombre, subtitle: grupo.email, groups },
      cssClass: 'options-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data === 'pago')              await this.registrarPago(grupo);
    if (data === 'toggle-suspension')  await this.toggleSuspensionNegocios(grupo);
    if (data === 'avisar-whatsapp')    this.avisarPurgaWhatsApp(grupo);
    if (data === 'purgar')             await this.purgarGrupo(grupo);
    if (data === 'cancelar-purga')     await this.cancelarPurga(grupo);
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
    return activos.length ? activos.join(' · ') : 'Sin módulos adicionales';
  }

  /**
   * Subtítulo del ítem "Registrar pago" en el menú del propietario: plan + estado
   * vigente. La suscripción es por dueño, así que todos sus negocios comparten plan;
   * tomamos el primero con suscripción como referencia.
   */
  private resumenSuscripcionGrupo(grupo: PropietarioGrupo): string {
    const s = grupo.negocios.find(n => n.suscripcion && n.suscripcion.estado !== 'SIN_SUSCRIPCION')?.suscripcion;
    if (!s) return 'Sin suscripción registrada';
    const plan = s.plan_nombre ? `${s.plan_nombre} · ` : '';
    return `${plan}${this.estadoLabel(s.estado)}`;
  }

  /** Color del badge de estado (data-attribute para el SCSS). */
  estadoColor(estado: string | undefined): string {
    switch (estado) {
      case 'ACTIVA':        return 'success';
      case 'TRIAL':         return 'primary';
      case 'TRIAL_VENCIDO': return 'warning';   // prueba expirada: nunca pagó (≠ vencida pagada)
      case 'VENCIDA':       return 'danger';
      case 'SUSPENDIDA':    return 'danger';
      case 'CANCELADA':     return 'medium';
      default:              return 'medium';  // SIN_SUSCRIPCION / sin dato
    }
  }

  estadoLabel(estado: string | undefined): string {
    switch (estado) {
      case 'ACTIVA':          return 'Activa';
      case 'TRIAL':           return 'Prueba';
      case 'TRIAL_VENCIDO':   return 'Prueba expirada';
      case 'VENCIDA':         return 'Vencida';
      case 'SUSPENDIDA':      return 'Suspendida';
      case 'CANCELADA':       return 'Cancelada';
      case 'SIN_SUSCRIPCION': return 'Sin plan';
      default:                return 'Sin plan';
    }
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

  /**
   * Suspende o reactiva por cobro TODOS los negocios de un dueño de una vez. La
   * suspensión es por dueño, no por sucursal (PRO = 1 negocio, MAX = N, una sola
   * suscripción los cubre). Los textos hablan de "negocio(s)" y se adaptan a
   * singular/plural; el dueño se nombra para que la confirmación sea inequívoca.
   */
  private async toggleSuspensionNegocios(grupo: PropietarioGrupo) {
    const suspender = !grupo.suspendido;
    const n = grupo.negocios.length;
    const uno = n === 1;

    const header = suspender
      ? (uno ? 'Suspender negocio' : 'Suspender negocios')
      : (uno ? 'Reactivar negocio' : 'Reactivar negocios');

    const message = suspender
      ? (uno
          ? `¿Suspender el negocio de ${grupo.nombre}? Usa esto cuando hay una deuda de cobro pendiente — el negocio quedará bloqueado hasta que registres el pago.`
          : `¿Suspender los ${n} negocios de ${grupo.nombre}? Usa esto cuando hay una deuda de cobro pendiente — todos quedarán bloqueados hasta que registres el pago.`)
      : (uno
          ? `¿Reactivar el negocio de ${grupo.nombre}? Solo para corregir una suspensión accidental — no reemplaza registrar el pago. El negocio volverá a operar hasta su vencimiento anterior.`
          : `¿Reactivar los ${n} negocios de ${grupo.nombre}? Solo para corregir una suspensión accidental — no reemplaza registrar el pago. Volverán a operar hasta su vencimiento anterior.`);

    const ok = await this.confirmar(header, message);
    if (!ok) return;

    const exito = await this.suscripcion.suspenderPropietario(grupo.usuario_id, suspender);
    if (exito) await this.cargar(true);
  }

  /**
   * Detecta propietarios vencidos hace ≥23 días y los marca para purga
   * (fn_marcar_negocios_para_purga). El superadmin la dispara manualmente desde
   * este botón — no hay cron (ver docs/suscripcion/SUSCRIPCION-README.md).
   */
  async detectarPurgaPendiente() {
    if (this.detectandoPurga) return;
    this.detectandoPurga = true;
    try {
      const marcados = await this.suscripcion.marcarNegociosParaPurga();
      await this.cargar(true);
      await this.ui.showToast(
        marcados.length > 0
          ? `${marcados.length} negocio(s) marcado(s) para purga.`
          : 'No hay nuevos negocios para marcar.',
        marcados.length > 0 ? 'warning' : 'success'
      );
    } finally {
      this.detectandoPurga = false;
    }
  }

  /**
   * Abre WhatsApp con un mensaje precargado al propietario marcado para purga,
   * usando el teléfono del negocio ancla (ver fn_listar_negocios_pendientes_purga).
   * La normalización del teléfono y la apertura de URL las maneja WhatsAppService.
   * El superadmin solo confirma el envío — no hay integración de envío automático.
   */
  private avisarPurgaWhatsApp(grupo: PropietarioGrupo) {
    const fechaPurga = grupo.purga
      ? new Date(grupo.purga.purga_programada_el).toLocaleDateString('es-EC', { day: 'numeric', month: 'long', year: 'numeric' })
      : '';
    const negocioPalabra  = grupo.negocios.length === 1 ? 'negocio' : `${grupo.negocios.length} negocios`;
    const nombresNegocios = grupo.negocios.map(n => n.nombre).join(', ');

    const lineas = [
      `Hola ${grupo.nombre}, te escribimos de Mi Tienda.`,
      `Tu suscripción venció y tu ${negocioPalabra} (${nombresNegocios}) será borrado permanentemente el ${fechaPurga} si no renuevas antes.`,
      'Esto incluye productos, ventas, clientes e historial — no se puede recuperar después.',
      'Responde este mensaje para coordinar tu pago y mantener tu negocio activo.',
    ];

    const abierto = this.whatsapp.abrir(grupo.purga?.telefono_contacto ?? '', lineas);
    if (!abierto) {
      this.ui.showToast('Este propietario no tiene un teléfono de contacto configurado.', 'warning');
    }
  }

  /**
   * Borrado real e irreversible (StorageService.deleteNegocioFolder + fn_purgar_negocio
   * por cada negocio del propietario, en ese orden — ver SuscripcionService.purgarNegocio).
   * Confirmación explícita con el nombre del propietario y advertencia.
   * Si algún negocio del lote falla, los demás siguen su curso — el toast final
   * indica cuáles no se pudieron purgar para reintentar manualmente.
   */
  private async purgarGrupo(grupo: PropietarioGrupo) {
    if (!grupo.purga?.puede_purgar_ya) {
      this.ui.showToast('La purga de este propietario aún no está habilitada.', 'warning');
      return;
    }

    const n = grupo.negocios.length;
    const nombresNegocios = grupo.negocios.map(neg => neg.nombre).join(', ');
    const ok = await this.confirmar(
      'Purgar negocio — acción irreversible',
      `¿Borrar permanentemente ${n === 1 ? 'el negocio' : `los ${n} negocios`} de ${grupo.nombre} (${nombresNegocios})? Se eliminarán productos, ventas, clientes, fotos y todo el historial. Esto NO se puede deshacer.`
    );
    if (!ok) return;

    let exitos = 0;
    const fallidos: string[] = [];
    for (const negocio of grupo.negocios) {
      const exito = await this.suscripcion.purgarNegocio(negocio.id);
      if (exito) exitos++;
      else fallidos.push(negocio.nombre);
    }

    if (fallidos.length > 0) {
      // purgarNegocio ya no lanza (captura el error de Storage internamente) —
      // si devuelve false, alguno falló: el superadmin necesita saber cuál no
      // se borró para reintentarlo manualmente, en vez de asumir éxito total.
      await this.ui.showToast(
        `No se pudo purgar: ${fallidos.join(', ')}. Revisa los logs y reintenta.`,
        'danger'
      );
    }
    if (exitos > 0) await this.cargar(true);
  }

  /** Excepción de soporte: cancela la purga programada sin que medie un pago real. */
  private async cancelarPurga(grupo: PropietarioGrupo) {
    const ok = await this.confirmar(
      'Cancelar purga',
      `¿Cancelar la purga programada de ${grupo.nombre}? Esto es una excepción de soporte — no reemplaza registrar un pago real. El negocio seguirá bloqueado hasta que renueve, pero ya no se borrará automáticamente.`
    );
    if (!ok) return;

    const exito = await this.suscripcion.cancelarPurgaNegocio(grupo.usuario_id);
    if (exito) await this.cargar(true);
  }

  /**
   * Abre el modal de registrar pago para un PROPIETARIO; recarga al confirmar.
   * El pago renueva TODOS sus negocios a la vez (la suscripción se paga por dueño).
   * El plan vigente se toma de cualquiera de sus negocios (todos comparten suscripción).
   */
  private async registrarPago(grupo: PropietarioGrupo) {
    const planCodigoActual = grupo.negocios
      .find(n => n.suscripcion && n.suscripcion.estado !== 'SIN_SUSCRIPCION')
      ?.suscripcion?.plan_codigo ?? null;

    const modal = await this.modalCtrl.create({
      component: RegistrarPagoModalComponent,
      componentProps: {
        propietarioId: grupo.usuario_id,
        propietarioNombre: grupo.nombre,
        cantidadNegocios: grupo.negocios.length,
        planCodigoActual,
      },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();
    const { role } = await modal.onDidDismiss();
    if (role === 'confirm') await this.cargar(true);
  }

  async salir() {
    await this.authService.logout();
  }

}
