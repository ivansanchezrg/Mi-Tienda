import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { NavController } from '@ionic/angular';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons,
  IonCard, IonIcon, IonButton, IonSkeletonText,
  ModalController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  logoWhatsapp, cardOutline, alertCircleOutline,
  checkmarkCircleOutline, copyOutline,
  logOutOutline, arrowBackOutline, sparklesOutline, arrowUpCircleOutline,
  phonePortraitOutline, tabletPortraitOutline, desktopOutline,
  businessOutline, layersOutline,
} from 'ionicons/icons';
import { SuscripcionService } from '@core/services/suscripcion.service';
import { AuthService } from '../../../auth/services/auth.service';
import { UiService } from '@core/services/ui.service';
import { WhatsAppService } from '@core/services/whatsapp.service';
import { ROUTES } from '@core/config/routes.config';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';
import { EstadoSuscripcionResult, ConfigPlataforma, Plan } from '../../models/suscripcion.model';
import { ContextoPago } from '../../components/coordinar-pago-modal/coordinar-pago-modal.component';
import { SuscripcionTabsComponent } from '../../components/suscripcion-tabs/suscripcion-tabs.component';

/** Etiquetas legibles de cada feature, para listar qué incluye un plan en su tarjeta. */
const FEATURE_LABELS: Record<string, string> = {
  panel_financiero: 'Panel financiero en tiempo real',
  pos:              'Punto de venta con escáner de productos',
  inventario:       'Inventario con control de stock y kardex',
  ventas:           'Historial de ventas y anulaciones',
  clientes:         'Clientes, créditos y fiados',
  empleados:        'Gestión de empleados y roles',
  nomina:           'Nómina, adelantos y cuenta corriente de empleados',
  notas:            'Notas compartidas entre el equipo',
  acciones_rapidas: 'Acciones rápidas (precio, margen de ganancia)',
  configuracion:    'Configuración completa del negocio',
  ia:               'Inteligencia artificial',
};

/**
 * Pantalla de suscripción — dos modos según el estado:
 *  - BLOQUEADA (vencida/suspendida/cancelada): "Suscríbete" con WhatsApp + cuentas de pago.
 *  - VIGENTE (trial/activa): "Planes y precios" — catálogo de planes (upsell vía WhatsApp).
 *
 * En modo informativo es un punto de venta, no solo un recibo: una sola lista de tarjetas
 * (plan actual marcado primero, luego los superiores). Toggle global Mensual/Anual que
 * cambia el precio mostrado de todas las tarjetas y resalta el ahorro anual. El cliente
 * no paga aquí (cobro manual); "Quiero este plan" abre WhatsApp con el lead pre-armado
 * (incluye el periodo elegido) y el superadmin registra el pago. Ver docs/suscripcion/SUSCRIPCION-README.md,
 * sección "Modo Planes y precios — punto de venta (upsell)".
 *
 * Es el destino del suscripcionGuard cuando bloquea. Vive fuera del layout
 * (sin tab bar/sidebar) para que el bloqueo sea pantalla completa.
 */
@Component({
  selector: 'app-suscripcion',
  templateUrl: './suscripcion.page.html',
  styleUrls: ['./suscripcion.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons,
    IonCard, IonIcon, IonButton, IonSkeletonText,
    AppCurrencyPipe,
    SuscripcionTabsComponent,
  ],
})
export class SuscripcionPage implements OnInit, OnDestroy {
  private suscripcion = inject(SuscripcionService);
  private auth        = inject(AuthService);
  private ui          = inject(UiService);
  private whatsapp    = inject(WhatsAppService);
  private navCtrl     = inject(NavController);
  private modalCtrl   = inject(ModalController);

  loading = true;
  estado: EstadoSuscripcionResult | null = null;
  config: ConfigPlataforma | null = null;
  planes: Plan[] = [];

  /** Refleja en vivo los cambios de suscripción (ej: el superadmin registra el pago
   *  mientras el cliente mira esta pantalla → la tarjeta pasa de "Activar" a "Renovar"). */
  private estadoSub?: Subscription;

  constructor() {
    addIcons({
      logoWhatsapp, cardOutline, alertCircleOutline,
      checkmarkCircleOutline, copyOutline,
      logOutOutline, arrowBackOutline, sparklesOutline, arrowUpCircleOutline,
      phonePortraitOutline, tabletPortraitOutline, desktopOutline,
      businessOutline, layersOutline,
    });
  }

  async ngOnInit() {
    await this.cargar();

    // El realtime del servicio (INSERT en suscripciones) fuerza una relectura y emite
    // por estado$ cuando el superadmin registra un pago o reactiva. Nos suscribimos para
    // que la tarjeta reaccione en vivo sin recargar la pantalla. Ignoramos null (es el
    // reset de invalidar(), no un estado real). Las transiciones a/desde "bloqueada" las
    // maneja el propio servicio redirigiendo; aquí solo refrescamos lo visible.
    this.estadoSub = this.suscripcion.estado$.subscribe((estado) => {
      if (estado) this.estado = estado;
    });
  }

  ngOnDestroy() {
    this.estadoSub?.unsubscribe();
  }

  async cargar() {
    this.loading = true;
    try {
      // Estado del cache (sin forzar) + datos de cobro + catálogo de planes, en paralelo.
      // No forzar: el Realtime actualiza el estado en tiempo real cuando cambia algo en BD.
      // Forzar aquí invalida el cache e introduce un round-trip innecesario que el
      // suscripcionGuard paga al navegar de vuelta a /caja (tiene que re-consultar BD).
      const [estado, config, planes] = await Promise.all([
        this.suscripcion.getEstado(),
        this.suscripcion.getConfigPlataforma(),
        this.suscripcion.listarPlanes(true),   // solo activos: lo que se ofrece hoy
      ]);
      this.estado = estado;
      this.config = config;
      this.planes = planes;
    } finally {
      this.loading = false;
    }
  }

  /** True si la suscripción está bloqueada → mostrar modo "Suscríbete". */
  get bloqueada(): boolean {
    return this.estado?.bloqueada === true;
  }

  /** Texto del badge de estado para el modo informativo. */
  get estadoLabel(): string {
    switch (this.estado?.estado) {
      case 'TRIAL':  return 'Periodo de prueba';
      case 'ACTIVA': return 'Activa';
      default:       return '';
    }
  }

  /**
   * True si el negocio está en periodo de prueba (aún no ha pagado nunca este plan).
   * En trial la tarjeta vende: badge "Estás probando" + CTA de compra ("Activar mi plan").
   * En activa la tarjeta tranquiliza: badge "Tu plan actual" + CTA de mantenimiento ("Renovar plan").
   */
  get esTrial(): boolean {
    return this.estado?.estado === 'TRIAL';
  }

  /**
   * True cuando quedan pocos días (≤3) para que termine la prueba — pinta la fecha
   * en color de alerta para empujar la conversión. Solo aplica en trial; en una
   * suscripción activa no queremos presionar al cliente que ya paga.
   */
  get trialPorVencer(): boolean {
    return this.esTrial
      && this.estado?.dias_restantes !== undefined
      && this.estado.dias_restantes <= 3;
  }

  // ── Modo bloqueo: el encabezado se adapta al ORIGEN del bloqueo ───────
  // TRIAL_VENCIDO (nunca pagó) ≠ VENCIDA (era cliente) ≠ SUSPENDIDA (lo bloqueó el admin).
  // El paso de pago (cuentas + WhatsApp) es el mismo; cambia título, texto y CTA.

  /** True si el bloqueo viene de una prueba gratuita que terminó (nunca hubo pago). */
  get esTrialVencido(): boolean {
    return this.estado?.estado === 'TRIAL_VENCIDO';
  }

  /** Título de la pantalla de bloqueo según el origen. */
  get bloqueoTitulo(): string {
    switch (this.estado?.estado) {
      case 'TRIAL_VENCIDO': return 'Tu prueba gratuita terminó';
      case 'VENCIDA':       return 'Tu suscripción venció';
      default:              return 'Suscripción suspendida';   // SUSPENDIDA | CANCELADA
    }
  }

  /** Subtítulo que da contexto y empuja a la acción correcta. */
  get bloqueoSubtitulo(): string {
    const negocio = this.negocioNombre || 'tu negocio';
    switch (this.estado?.estado) {
      case 'TRIAL_VENCIDO':
        return `Tu periodo de prueba llegó a su fin. Activa tu plan para seguir usando ${negocio}.`;
      case 'VENCIDA':
        return `Tu suscripción venció. Renueva tu plan para seguir operando ${negocio}.`;
      default:
        return `El acceso a ${negocio} está suspendido. Realiza tu pago para reactivarlo.`;
    }
  }

  /** Texto del paso 2 (envío de comprobante) — coherente con activar/renovar/reactivar. */
  get bloqueoPaso2Texto(): string {
    switch (this.estado?.estado) {
      case 'TRIAL_VENCIDO':
        return 'Una vez realizado el pago, contáctanos por WhatsApp con la foto o número del comprobante para activar tu plan.';
      case 'VENCIDA':
        return 'Una vez realizado el pago, contáctanos por WhatsApp con la foto o número del comprobante para renovar tu plan.';
      default:
        return 'Una vez realizado el pago, contáctanos por WhatsApp con la foto o número del comprobante para reactivar tu cuenta.';
    }
  }

  /** Label del botón principal de WhatsApp según el origen del bloqueo. */
  get bloqueoBotonLabel(): string {
    switch (this.estado?.estado) {
      case 'TRIAL_VENCIDO': return 'Activar mi plan';
      case 'VENCIDA':       return 'Renovar mi plan';
      default:              return 'Contactar por WhatsApp';
    }
  }

  get negocioNombre(): string {
    return this.auth.usuarioActualValue?.negocio_nombre ?? '';
  }

  get usuarioEmail(): string {
    return this.auth.usuarioActualValue?.email ?? '';
  }

  get negocioSlug(): string {
    return this.auth.usuarioActualValue?.negocio_slug ?? '';
  }

  // ── Catálogo de planes (upsell en modo informativo) ──────────────────

  /** Periodo de visualización del catálogo (toggle global Mensual/Anual). */
  periodoVista: 'MENSUAL' | 'ANUAL' = 'MENSUAL';

  /** True si AL MENOS un plan ofrece pago anual → mostrar el toggle. */
  get hayPlanesAnuales(): boolean {
    return this.planes.some(p => p.precio_anual != null);
  }

  /** Precio del plan según el periodo de vista. Si pide anual y el plan no lo ofrece, cae a mensual. */
  precioDe(plan: Plan): number {
    return this.periodoVista === 'ANUAL' && plan.precio_anual != null
      ? plan.precio_anual
      : plan.precio_mensual;
  }

  /** Sufijo de periodo ('mes' | 'año') según lo que se muestra para ese plan. */
  periodoLabelDe(plan: Plan): string {
    return this.periodoVista === 'ANUAL' && plan.precio_anual != null ? 'año' : 'mes';
  }

  /**
   * Equivalente mensual del precio anual ($99.99/año → $8.33/mes) para mostrar
   * "facturado anual". Solo aplica si el plan ofrece anual y la vista es ANUAL.
   */
  equivalenteMensual(plan: Plan): number | null {
    if (this.periodoVista !== 'ANUAL' || plan.precio_anual == null) return null;
    return plan.precio_anual / 12;
  }

  /**
   * Ahorro anual frente a pagar 12 meses sueltos ($9.99×12 − $99.99 = $19.89).
   * Null si el plan no ofrece anual o la vista no es anual.
   */
  ahorroAnual(plan: Plan): number | null {
    if (this.periodoVista !== 'ANUAL' || plan.precio_anual == null) return null;
    const ahorro = plan.precio_mensual * 12 - plan.precio_anual;
    return ahorro > 0 ? ahorro : null;
  }

  setPeriodoVista(periodo: 'MENSUAL' | 'ANUAL') {
    this.periodoVista = periodo;
  }

  /** Código del plan que el negocio tiene hoy (para marcarlo como "actual"). */
  get planActualCodigo(): string | undefined {
    return this.estado?.plan_codigo;
  }

  /** True si ese plan es el que el negocio ya tiene contratado. */
  esPlanActual(plan: Plan): boolean {
    return plan.codigo === this.planActualCodigo;
  }

  /**
   * True si la tarjeta debe mostrarse como "plan vigente" — es decir, el usuario
   * ya tiene este plan EN EL PERIODO que está viendo en el toggle.
   *
   * Cuando el toggle está en ANUAL y el usuario tiene Mensual (o el plan no ofrece
   * anual), la tarjeta del plan actual se convierte en una opción de upsell —
   * no debe mostrar "Tu plan actual" ni el estado/vencimiento.
   */
  esPlanVigente(plan: Plan): boolean {
    if (!this.esPlanActual(plan)) return false;
    const periodoContratado = this.estado?.periodo ?? 'MENSUAL';
    // Si el toggle pide anual pero el plan no lo ofrece, el precio que se muestra
    // sigue siendo mensual → coincide con lo que tiene → sí es vigente.
    if (this.periodoVista === 'ANUAL' && plan.precio_anual == null) return true;
    return this.periodoVista === periodoContratado;
  }

  /**
   * Plan "recomendado": el más caro entre los que el usuario NO tiene vigentes
   * en la vista actual. Si la vista es ANUAL y tiene Mensual, su propio plan
   * aparece como recomendable (upgrade de periodo).
   */
  get planRecomendadoCodigo(): string | undefined {
    const superiores = this.planes
      .filter(p => !this.esPlanVigente(p))
      .sort((a, b) => b.precio_mensual - a.precio_mensual);
    return superiores[0]?.codigo;
  }

  esRecomendado(plan: Plan): boolean {
    return plan.codigo === this.planRecomendadoCodigo;
  }

  /**
   * Planes en el orden de presentación: el actual primero (referencia), luego los
   * superiores de menor a mayor precio. El ojo lee "lo que tengo → a lo que subo",
   * y el plan tope/recomendado cierra la pantalla (donde queremos que termine).
   */
  get planesOrdenados(): Plan[] {
    return [...this.planes].sort((a, b) => {
      if (this.esPlanVigente(a)) return -1;   // vigente en esta vista siempre arriba
      if (this.esPlanVigente(b)) return 1;
      return a.precio_mensual - b.precio_mensual;   // resto ascendente
    });
  }

  /**
   * Planes ordenados por precio mensual ascendente (sin importar cuál es el actual).
   * Se usa internamente para calcular qué features aporta cada nivel.
   */
  private get planesPorPrecio(): Plan[] {
    return [...this.planes].sort((a, b) => a.precio_mensual - b.precio_mensual);
  }

  /** Claves de features activas de un plan. */
  private clavesActivas(plan: Plan): Set<string> {
    return new Set(
      Object.entries(plan.features ?? {})
        .filter(([, v]) => v === true)
        .map(([k]) => k)
    );
  }

  /**
   * Features NUEVAS que aporta este plan respecto al plan inmediatamente inferior
   * (el anterior en precio). Para el plan más barato devuelve todas sus features
   * (no tiene predecesor). El resultado se muestra en verde bajo "Todo lo del X, más:".
   */
  featuresNuevasDe(plan: Plan): string[] {
    const ordenados = this.planesPorPrecio;
    const idx = ordenados.findIndex(p => p.id === plan.id);
    const propias = this.clavesActivas(plan);

    if (idx <= 0) {
      // Plan más barato: todas sus features son "nuevas" (no hereda nada).
      return [...propias].map(k => FEATURE_LABELS[k] ?? k);
    }

    const anterior = ordenados[idx - 1];
    const heredadas = this.clavesActivas(anterior);
    return [...propias]
      .filter(k => !heredadas.has(k))
      .map(k => FEATURE_LABELS[k] ?? k);
  }

  /**
   * Nombre del plan predecesor (el de menor precio inmediato).
   * Devuelve undefined para el plan más barato (no hereda de nadie).
   */
  planPredecesorNombre(plan: Plan): string | undefined {
    const ordenados = this.planesPorPrecio;
    const idx = ordenados.findIndex(p => p.id === plan.id);
    return idx > 0 ? ordenados[idx - 1].nombre : undefined;
  }

  /**
   * Modo bloqueo: activar (trial vencido), renovar (vencida) o reactivar (suspendida).
   * La acción y el lenguaje del lead se derivan del origen del bloqueo — el cliente que
   * nunca pagó "activa", el que era cliente "renueva", el que fue suspendido "reactiva".
   */
  async contactarWhatsApp() {
    let accion: ContextoPago['accion'];
    let verbo: string;
    switch (this.estado?.estado) {
      case 'TRIAL_VENCIDO': accion = 'activar';   verbo = 'activar';   break;
      case 'VENCIDA':       accion = 'renovar';   verbo = 'renovar';   break;
      default:              accion = 'reactivar'; verbo = 'reactivar'; break;
    }

    const contexto: ContextoPago = {
      planNombre:    this.estado?.plan_nombre  ?? 'Tu plan',
      precio:        this.estado?.precio       ?? 0,
      periodo:       (this.estado?.periodo as 'MENSUAL' | 'ANUAL') ?? 'MENSUAL',
      negocioNombre: this.negocioNombre,
      accion,
    };
    const intro = `Hola, quiero ${verbo} la suscripción de mi negocio "${this.negocioNombre}".`;
    await this.abrirModalPago(contexto, intro);
  }

  /** Modo trial: activar (primera compra) el plan que se está probando. */
  async activarPlan() {
    const contexto: ContextoPago = {
      planNombre:    this.estado?.plan_nombre  ?? 'Tu plan',
      precio:        this.estado?.precio       ?? 0,
      periodo:       (this.estado?.periodo as 'MENSUAL' | 'ANUAL') ?? 'MENSUAL',
      negocioNombre: this.negocioNombre,
      accion:        'activar',
    };
    const periodo = this.estado?.periodo === 'ANUAL' ? 'año' : 'mes';
    const precio  = this.estado?.precio?.toFixed(2) ?? '0.00';
    const intro   = `Hola, quiero activar ${contexto.planNombre} ($${precio}/${periodo}) para mi negocio "${this.negocioNombre}".`;
    await this.abrirModalPago(contexto, intro);
  }

  /** Modo vigente: renovar el plan actual antes de vencer. */
  async renovarPlan() {
    const contexto: ContextoPago = {
      planNombre:    this.estado?.plan_nombre  ?? 'Tu plan',
      precio:        this.estado?.precio       ?? 0,
      periodo:       (this.estado?.periodo as 'MENSUAL' | 'ANUAL') ?? 'MENSUAL',
      negocioNombre: this.negocioNombre,
      accion:        'renovar',
    };
    const periodo = this.estado?.periodo === 'ANUAL' ? 'año' : 'mes';
    const precio  = this.estado?.precio?.toFixed(2) ?? '0.00';
    const intro   = `Hola, quiero renovar ${contexto.planNombre} ($${precio}/${periodo}) para mi negocio "${this.negocioNombre}".`;
    await this.abrirModalPago(contexto, intro);
  }

  /** Modo upsell: cambiar a un plan distinto o cambiar de periodo. */
  async solicitarPlan(plan: Plan) {
    const contexto: ContextoPago = {
      planNombre:    plan.nombre,
      precio:        this.precioDe(plan),
      periodo:       this.periodoVista,
      negocioNombre: this.negocioNombre,
      accion:        'cambiar',
    };
    const precio  = this.precioDe(plan).toFixed(2);
    const periodo = this.periodoLabelDe(plan);
    const accion  = this.esPlanActual(plan) ? 'cambiar a pago anual en' : 'cambiar al';
    const intro   = `Hola, quiero ${accion} ${plan.nombre} ($${precio}/${periodo}) para mi negocio "${this.negocioNombre}".`;
    await this.abrirModalPago(contexto, intro);
  }

  /** Abre el modal de método de pago y construye el mensaje de WhatsApp. */
  private async abrirModalPago(contexto: ContextoPago, introWhatsApp: string) {
    // Validar antes de abrir el modal para no hacer perder el tiempo al usuario
    // si no hay teléfono configurado — misma validación que hace whatsapp.abrir()
    // internamente, pero aquí se ejecuta por adelantado para dar feedback inmediato.
    if (!this.config?.whatsapp_cobro) {
      this.ui.showToast('No hay un número de contacto configurado. Intenta más tarde.', 'warning');
      return;
    }

    const { CoorinarPagoModalComponent } = await import('../../components/coordinar-pago-modal/coordinar-pago-modal.component');
    const modal = await this.modalCtrl.create({
      component: CoorinarPagoModalComponent,
      componentProps: { contexto },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss<{ metodo: string; referencia: string }>();
    if (role !== 'confirm' || !data) return;

    const lineas: string[] = [
      introWhatsApp,
      `ID negocio: ${this.negocioSlug}`,
      `Cuenta: ${this.usuarioEmail}`,
      `Método de pago: ${this.labelMetodo(data.metodo)}`,
    ];

    if (data.metodo === 'TRANSFERENCIA' || data.metodo === 'DEPOSITO') {
      // La instrucción de enviar la foto ya se le dio en el modal — no se repite aquí
      // (sería redundante y el superadmin la recibiría como una orden a sí mismo).
      if (data.referencia) lineas.push(`Referencia: ${data.referencia}`);
    } else {
      // Efectivo: no hay foto que enviar — esta nota le confirma qué pasará (la visita).
      lineas.push('Nota: Nuestro equipo coordinará contigo la visita para el cobro.');
    }

    this.whatsapp.abrir(this.config.whatsapp_cobro, lineas);
  }

  private labelMetodo(metodo: string): string {
    switch (metodo) {
      case 'TRANSFERENCIA': return 'Transferencia bancaria';
      case 'DEPOSITO':      return 'Depósito';
      case 'EFECTIVO':      return 'Efectivo';
      default:              return metodo;
    }
  }

  /**
   * Vuelve al home (solo modo informativo "Mi Plan"). Esta pantalla vive fuera del
   * layout, así que no tiene sidebar/tabs: la flecha del header reemplaza al menú
   * hamburguesa (que aquí no abriría nada).
   *
   * Usa navCtrl.back() en vez de navigateBack(ROUTES.home): pop del stack de Ionic
   * sin resolver la ruta destino, así el suscripcionGuard NO se re-ejecuta y la
   * animación de retroceso arranca de forma inmediata. navigateBack() resolvía la
   * ruta completa de /caja (con guards) antes de iniciar la animación → delay visible.
   */
  volverAlHome() {
    this.navCtrl.back();
  }

  /** Cierra sesión — única salida desde la pantalla de bloqueo (no hay sidebar/tabs aquí). */
  async cerrarSesion() {
    await this.auth.logout();
  }

  /** Copia el número de cuenta al portapapeles (conveniencia para transferir). */
  async copiarCuenta(numero: string) {
    try {
      // navigator.clipboard funciona en web y en el WebView de Android (Capacitor expone la API web).
      await navigator.clipboard.writeText(numero);
      await this.ui.showToast('Número de cuenta copiado', 'success');
    } catch {
      await this.ui.showToast('No se pudo copiar', 'warning');
    }
  }
}
