import { Component, OnInit, OnDestroy, inject, HostListener, ViewChild, ElementRef, signal, computed, Signal, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonTitle, IonToolbar,
  IonButtons, IonMenuButton, IonButton, IonIcon,
  IonFooter, IonList, IonItem, IonBadge, IonSpinner, IonSkeletonText,
  IonItemSliding, IonItemOptions, IonItemOption,
  IonRefresher, IonRefresherContent,
  AlertController, ModalController, ViewDidLeave, ViewWillEnter
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { BarcodeScannerService } from '../../../../core/services/barcode-scanner.service';
import { barcodeOutline, cartOutline, cashOutline, addOutline, removeOutline, trashOutline, cubeOutline, searchOutline, addCircleOutline, cardOutline, phonePortraitOutline, handRightOutline, personOutline, chevronForwardOutline, chevronBackOutline, refreshOutline, alertCircleOutline, closeOutline, checkmarkOutline, pricetagOutline, chevronDownCircleOutline, gridOutline, listOutline } from 'ionicons/icons';
import { CategoriaProducto } from '../../../inventario/models/categoria-producto.model';
import { TipoComprobante } from '../../models/tipo-comprobante.enum';
import { OptionsMenuComponent, MenuOption } from '../../../../shared/components/options-menu/options-menu.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { InventarioService } from '../../../inventario/services/inventario.service';
import { ProductoPOS, ProductoPresentacion } from '../../../inventario/models/producto.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { PosService, VentaPayload } from '../../services/pos.service';
import { CartItem, CatalogoItem, ResultadoBusquedaPOS } from '../../models/cart-item.model';
import { ClientesService } from '../../../clientes/services/clientes.service';
import { Cliente } from '../../../clientes/models/cliente.model';
import { SeleccionarClienteModalComponent } from '../../../clientes/components/seleccionar-cliente-modal/seleccionar-cliente-modal.component';
import { CobrarModalComponent } from '../../components/cobrar-modal/cobrar-modal.component';
import { CantidadModalComponent, CantidadModalResult } from '../../components/cantidad-modal/cantidad-modal.component';
import { VarianteSelectorModalComponent, VarianteSelectorResult } from '../../components/variante-selector-modal/variante-selector-modal.component';
import { NetworkService } from '../../../../core/services/network.service';
import { CatalogoLocalService } from '../../../../core/services/catalogo-local.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { StorageService } from '../../../../core/services/storage.service';
import { ConfigService } from '../../../../core/services/config.service';
import { Configuracion } from '../../../configuracion/models/configuracion.model';
import { ROUTES } from '../../../../core/config/routes.config';

@Component({
  selector: 'app-pos',
  templateUrl: './pos.page.html',
  styleUrls: ['./pos.page.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonContent, IonHeader, IonTitle, IonToolbar,
    IonButtons, IonMenuButton, IonButton, IonIcon,
    IonFooter, IonList, IonItem, IonBadge, IonSpinner, IonSkeletonText,
    IonItemSliding, IonItemOptions, IonItemOption,
    IonRefresher, IonRefresherContent,
    CommonModule, FormsModule,
    OptionsMenuComponent, EmptyStateComponent
  ]
})
export class PosPage implements OnInit, OnDestroy, ViewDidLeave, ViewWillEnter {
  @ViewChild(IonContent) content!: IonContent;
  @ViewChild('panelItems') panelItemsRef!: ElementRef<HTMLElement>;

  private inventarioService = inject(InventarioService);
  protected currencyService = inject(CurrencyService);
  private ui = inject(UiService);
  private posService = inject(PosService);
  private alertCtrl = inject(AlertController);
  private modalCtrl = inject(ModalController);
  private clientesService = inject(ClientesService);
  protected barcodeScanner = inject(BarcodeScannerService);
  private network = inject(NetworkService);
  private catalogoLocal = inject(CatalogoLocalService);
  private logger = inject(LoggerService);
  private storageService = inject(StorageService);
  private configService = inject(ConfigService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  // Exponer enum al template (para el @if de mostrarDesglose)
  readonly TipoComprobante = TipoComprobante;

  lastAddedKey: string | null = null;
  lastIncrementedKey: string | null = null;
  // ID del item cuyo modal de cantidad está cargando (consulta stock fresco de BD)
  editandoItemKey: string | null = null;
  readonly carrito = signal<CartItem[]>([]);
  readonly buscarTexto = signal('');
  productosBusqueda: ProductoPOS[] = [];
  buscando = false;
  modoBusqueda: 'codigo' | 'nombre' = 'nombre';
  private searchVersion = 0;
  escaneando = false;
  cobroEnProceso = false;
  scanPreview: { nombre: string; cantidad: number; subtotal: number; precioUnitario: number } | null = null;
  private scanPreviewTimeout: ReturnType<typeof setTimeout> | undefined;

  clienteSeleccionado: Cliente | null = null;
  cargandoCliente = false;
  errorCliente = false;       // fallo de red / error inesperado
  sinConsumidorFinal = false; // la BD no tiene ningún consumidor final creado

  // ==========================
  // VISTA CATÁLOGO
  // ==========================
  vistaActual: 'lista' | 'catalogo' = 'catalogo';
  // Recuerda si el usuario venía del catálogo al ir a lista (para volver tras cobrar)
  protected volvioDesdeCatalogo = false;

  // En desktop (≥992px) el panel lateral muestra el carrito — no se alterna vista
  get esDesktop(): boolean { return window.innerWidth >= 992; }
  categoriasCatalogo: CategoriaProducto[] = [];
  categoriaActivaId: string | null = null;  // null = TODOS
  readonly productosCatalogo = signal<ProductoPOS[]>([]);
  cargandoCatalogo = false;
  catalogoSearchAbierto = false;

  // IDs de productos con animación activa en el catálogo
  catalogoCardAnimando: string | null = null;
  totalAmountAnimando = false;

  private dispararAnimacionPanel(itemKey: string) {
    if (!this.esDesktop) return;
    setTimeout(() => {
      const panel = this.panelItemsRef?.nativeElement;
      if (!panel) return;
      const itemEl = panel.querySelector<HTMLElement>(`[data-item-key="${CSS.escape(itemKey)}"]`);
      if (itemEl) {
        itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        panel.scrollTo({ top: panel.scrollHeight, behavior: 'smooth' });
      }
    }, 30);
  }

  private dispararAnimacionCatalogo(productoId: string) {
    this.catalogoCardAnimando = productoId;
    this.cdr.markForCheck();
    setTimeout(() => { this.catalogoCardAnimando = null; this.cdr.markForCheck(); }, 400);
    setTimeout(() => {
      this.totalAmountAnimando = true;
      this.cdr.markForCheck();
      setTimeout(() => { this.totalAmountAnimando = false; this.cdr.markForCheck(); }, 500);
    }, 150);
  }

  abrirCatalogoSearch() {
    this.catalogoSearchAbierto = true;
    this.cdr.markForCheck();
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.cat-search-input');
      input?.focus();
    }, 260);
  }

  cerrarCatalogoSearch() {
    this.catalogoSearchAbierto = false;
    this.limpiarBusqueda();
    this.cdr.markForCheck();
  }

  /** Tipo de comprobante — solo lectura, configurado por el superadmin */
  tipoComprobante: TipoComprobante = TipoComprobante.TICKET;

  /** Opciones del menú ⋮ */
  readonly ACCION_LIMPIAR = '__LIMPIAR__';

  comprobanteOptions: MenuOption[] = [
    { label: 'Limpiar carrito', icon: 'trash-outline', value: '__LIMPIAR__', active: false, color: 'danger' },
  ];

  /** Handler del menú ⋮ */
  async onComprobanteOption(option: MenuOption) {
    if (option.value === this.ACCION_LIMPIAR) {
      if (this.carrito().length === 0) return;
      await this.confirmarLimpiarCarrito();
    }
  }

  /** Pill del catálogo → ir a lista para revisar y cobrar (solo mobile) */
  async irAListaDesdeCatalogo() {
    if (this.esDesktop) return;
    this.volvioDesdeCatalogo = true;
    this.vistaActual = 'lista';
    this.catalogoSearchAbierto = false;
    this.limpiarBusqueda();
  }

  /** Desde lista → volver al catálogo (botón atrás en modo lista cuando vino del catálogo) */
  async volverAlCatalogo() {
    this.volvioDesdeCatalogo = false;
    this.vistaActual = 'catalogo';
  }

  async cargarCatalogo() {
    this.categoriaActivaId = null;

    // Stale-while-revalidate: si hay cache local, pinta la cuadrícula al instante
    // (sin spinner) y refresca contra el servidor en segundo plano. Arranque percibido
    // inmediato, como una app profesional. Sin cache, muestra el skeleton normal.
    const huboCache = await this.pintarDesdeCacheSiExiste();
    if (!huboCache) {
      this.cargandoCatalogo = true;
      this.cdr.markForCheck();
    }

    try {
      const categorias = await this.inventarioService.obtenerCategorias();
      this.categoriasCatalogo = categorias;
      // Pasar las categorías ya cargadas evita una query extra al guardar el cache.
      const productos = await this.inventarioService.obtenerProductosCatalogoPOS(undefined, categorias);
      // Pinta la cuadrícula fresca al instante; las imágenes se resuelven en background.
      this.publicarCatalogoConImagenesProgresivas(productos);
    } finally {
      this.cargandoCatalogo = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Pinta el catálogo desde el cache local si existe, para un arranque instantáneo
   * mientras se refresca contra el servidor. Devuelve true si pintó algo.
   * Las imágenes cacheadas (paths) se resuelven en background como en cualquier carga.
   */
  private async pintarDesdeCacheSiExiste(): Promise<boolean> {
    const cacheados = await this.catalogoLocal.obtenerCatalogoPorCategoria();
    if (cacheados.length === 0) return false;
    const categoriasCache = await this.catalogoLocal.obtenerCategorias();
    if (categoriasCache.length > 0) this.categoriasCatalogo = categoriasCache;
    this.publicarCatalogoConImagenesProgresivas(cacheados);
    return true;
  }

  async seleccionarCategoriaCatalogo(categoriaId: string | null) {
    if (this.categoriaActivaId === categoriaId) return;
    this.categoriaActivaId  = categoriaId;
    this.cdr.markForCheck();

    // Scroll automático al tab activo dentro de la barra horizontal
    setTimeout(() => {
      const attrValue = categoriaId ?? '__todos__';
      const tabEl = document.querySelector<HTMLElement>(`.catalogo-cats-bar [data-cat-id="${attrValue}"]`);
      tabEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 0);

    // Si hay cache en memoria el filtro es puro JS — no hay I/O, no hace falta spinner
    const instantaneo = !this.network.isConnected() && this.catalogoLocal.tieneCacheEnMemoria();
    if (!instantaneo) {
      this.cargandoCatalogo = true;
      this.cdr.markForCheck();
    }
    try {
      const productos = await this.inventarioService.obtenerProductosCatalogoPOS(categoriaId ?? undefined);
      // Pinta al instante reutilizando imágenes ya resueltas; resuelve nuevas en background.
      this.publicarCatalogoConImagenesProgresivas(productos);
    } finally {
      this.cargandoCatalogo = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Publica el catálogo en dos pasos para que la cuadrícula aparezca al instante:
   *  Paso 1 (síncrono): pinta los productos reutilizando las imágenes ya resueltas en
   *    el catálogo actual (mismo producto/template) → 0 llamadas a Storage, render inmediato.
   *  Paso 2 (background): resuelve las URLs nuevas sin bloquear la UI y re-publica.
   * Único punto de pintado del catálogo — lo usan cargarCatalogo, filtro y refresco.
   */
  private publicarCatalogoConImagenesProgresivas(productos: ProductoPOS[]) {
    const catalogoActual = this.productosCatalogo();
    const imagenesCacheadas = new Map(catalogoActual.map(p => [p.id, p.imagen_url]));
    const templateImagenesCacheadas = new Map(
      catalogoActual
        .filter(p => p.producto_template_id && p.producto_template?.imagen_url?.startsWith('http'))
        .map(p => [p.producto_template_id!, p.producto_template!.imagen_url!])
    );

    // Paso 1: pintar ya, con las imágenes que tengamos a mano.
    // Solo se usa una URL si ya está firmada (http). Si solo hay path crudo de Storage,
    // se deja undefined (placeholder) — pintarlo haría que <img> pida el path como ruta
    // local (localhost/{path}) → 404 en consola. El Paso 2 lo firma y re-publica.
    const urlFirmada = (valor: string | null | undefined): string | undefined =>
      valor?.startsWith('http') ? valor : undefined;

    const productosConImagenCacheada = productos.map(p => {
      const result = { ...p, imagen_url: urlFirmada(imagenesCacheadas.get(p.id) ?? p.imagen_url) };
      if (result.producto_template) {
        result.producto_template = {
          ...result.producto_template,
          imagen_url: urlFirmada(templateImagenesCacheadas.get(p.producto_template_id!) ?? result.producto_template.imagen_url)
        };
      }
      return result;
    });
    this.productosCatalogo.set(productosConImagenCacheada);
    this.cdr.markForCheck();

    // Paso 2: resolver las URLs faltantes en background, sin bloquear el render
    this.resolverImagenesCatalogo(productos).then(productosConImg => {
      this.productosCatalogo.set(productosConImg);
      this.cdr.markForCheck();
    }).catch(() => { /* imagen fallida no rompe el flujo */ });
  }

  private async resolverImagenesCatalogo(productos: ProductoPOS[]): Promise<ProductoPOS[]> {
    return Promise.all(productos.map(p => this.resolverImagen(p)));
  }

  async editarCantidadDesdeCatalogo(producto: ProductoPOS) {
    // Toma el primer CartItem del carrito que corresponda a este producto
    const item = this.carrito().find(i => i.id === producto.id);
    if (!item) return;
    await this.editarCantidad(item);
  }

  async abrirVariantesDesdeCatalogo(item: CatalogoItem & { tipo: 'template' }) {
    const subtitle = item.templateAtributos.length > 0
      ? `Selecciona el ${item.templateAtributos.join(' / ').toLowerCase()}`
      : `Selecciona una opción de ${item.templateNombre}`;
    await this.mostrarSelectorVariantes(item.templateNombre, item.variantes, subtitle);
  }

  async agregarDesdeCatalogo(producto: ProductoPOS, event?: MouseEvent | TouchEvent) {
    // Capturar card y rect ANTES del await — tras el re-render el card puede reordenarse
    const cardEl = event
      ? ((event.currentTarget ?? event.target) as HTMLElement).closest('.catalogo-card') as HTMLElement | null
      : null;
    const cardRect  = cardEl?.getBoundingClientRect() ?? null;
    const cardClone = cardEl?.cloneNode(true) as HTMLElement | null ?? null;

    const tienePresentaciones = (producto.presentaciones?.length ?? 0) > 0;
    const totalAntes = this.totalArticulos();
    await this.seleccionarResultadoBusqueda({ tipo: 'simple', producto }, false);
    const seAgrego = this.totalArticulos() > totalAntes;

    // Solo animar en productos simples sin presentaciones — en presentaciones/variantes
    // el flujo pasa por un modal y la animación se siente desfasada
    if (seAgrego && !tienePresentaciones) {
      navigator.vibrate?.(30);
      this.dispararAnimacionCatalogo(producto.id);
      this.dispararAnimacionPanel(producto.id);
      if (cardRect && cardClone) setTimeout(() => this.flyToPillFromClone(cardClone, cardRect), 0);
    }
  }

  /** Anima un clon visual exacto del card volando hacia el pill (mobile) o el total del panel (desktop) */
  private flyToPillFromClone(cardClone: HTMLElement, cardRect: DOMRect) {
    const esVisible = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const pill   = document.querySelector<HTMLElement>('.catalogo-cart-pill');
    const panel  = document.querySelector<HTMLElement>('.panel-total-monto');
    const pillEl = (pill && esVisible(pill)) ? pill : (panel && esVisible(panel)) ? panel : null;
    if (!pillEl) return;

    const pillRect = pillEl.getBoundingClientRect();
    const pillCx   = pillRect.left + pillRect.width  / 2;
    const pillCy   = pillRect.top  + pillRect.height / 2;

    cardClone.style.cssText = `
      position: fixed;
      left: ${cardRect.left}px;
      top: ${cardRect.top}px;
      width: ${cardRect.width}px;
      height: ${cardRect.height}px;
      margin: 0;
      pointer-events: none;
      z-index: 9999;
      border-radius: var(--radius-md);
      overflow: hidden;
      outline: none;
      border: none;
      -webkit-tap-highlight-color: transparent;
      box-shadow: 0 8px 24px rgba(0,0,0,0.2);
      opacity: 1;
      transform: scale(1);
      transition:
        left      0.45s cubic-bezier(0.4, 0, 0.2, 1),
        top       0.45s cubic-bezier(0.4, 0, 0.2, 1),
        width     0.45s cubic-bezier(0.4, 0, 0.2, 1),
        height    0.45s cubic-bezier(0.4, 0, 0.2, 1),
        opacity   0.35s ease 0.15s,
        transform 0.45s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    document.body.appendChild(cardClone);

    // Forzar reflow para que la transición arranque desde el estado inicial
    cardClone.getBoundingClientRect();

    // Estado final: encoge hasta el centro del pill y desaparece
    const size = 32;
    cardClone.style.left      = `${pillCx - size / 2}px`;
    cardClone.style.top       = `${pillCy - size / 2}px`;
    cardClone.style.width     = `${size}px`;
    cardClone.style.height    = `${size}px`;
    cardClone.style.opacity   = '0';
    cardClone.style.transform = 'scale(0.3)';

    cardClone.addEventListener('transitionend', () => cardClone.remove(), { once: true });
  }

  /** Pide confirmación antes de vaciar el carrito */
  private async confirmarLimpiarCarrito() {
    const alert = await this.alertCtrl.create({
      header: 'Limpiar carrito',
      message: `¿Descartas los ${this.totalArticulos()} artículos del carrito?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Limpiar',
          role: 'destructive',
          handler: () => this.limpiarCarrito()
        }
      ]
    });
    await alert.present();
  }

  // Buffer para pistola lectora física
  private barcodeBuffer = '';
  private barcodeTimeout: ReturnType<typeof setTimeout> | undefined;

  // Anti-duplicados para escáner de cámara
  private ultimoCodigoEscaneado = '';
  private ultimoTiempoEscaneado = 0;
  private procesandoEscaneo = false;

  // Configuración de descuentos (cargada una vez al init)
  private appConfig: Configuracion | null = null;

  // Control de página activa (Ionic cachea páginas)
  private paginaActiva = true;

  constructor() {
    addIcons({
      barcodeOutline, cartOutline, cashOutline,
      addOutline, removeOutline, trashOutline,
      cubeOutline, searchOutline, addCircleOutline,
      cardOutline, phonePortraitOutline, handRightOutline,
      personOutline, chevronForwardOutline, chevronBackOutline, refreshOutline, alertCircleOutline, closeOutline, checkmarkOutline, pricetagOutline, chevronDownCircleOutline,
      gridOutline, listOutline
    });
  }

  async ngOnInit() {
    await Promise.all([
      this.cargarCliente(),
      this.cargarConfig(),
      this.cargarCatalogo()
    ]);
  }

  private async cargarConfig() {
    this.appConfig = await this.configService.get();
    this.tipoComprobante = this.appConfig.pos_tipo_comprobante as TipoComprobante;
    this.cdr.markForCheck();
  }

  async cargarCliente() {
    this.cargandoCliente = true;
    this.errorCliente = false;
    this.sinConsumidorFinal = false;
    this.cdr.markForCheck();
    try {
      this.clienteSeleccionado = await this.clientesService.obtenerConsumidorFinal();
      if (!this.clienteSeleccionado) {
        this.sinConsumidorFinal = true;
      }
    } catch {
      this.errorCliente = true;
    } finally {
      this.cargandoCliente = false;
      this.cdr.markForCheck();
    }
  }

  // ==========================
  // LÓGICA DEL CARRITO
  // ==========================

  readonly totalArticulos = computed(() => this.carrito().reduce((sum, item) => sum + item.cantidad, 0));

  /** Productos del catálogo filtrados y agrupados por template (variantes). Computed: solo recalcula cuando cambia el catálogo o el texto de búsqueda. */
  readonly itemsCatalogo = computed<CatalogoItem[]>(() => {
    const texto = this.buscarTexto().trim().toLowerCase();
    const fuente = texto
      ? this.productosCatalogo().filter(p =>
          p.nombre.toLowerCase().includes(texto) ||
          (p.codigo_barras?.toLowerCase().includes(texto) ?? false)
        )
      : this.productosCatalogo();
    return this.agruparParaCatalogo(fuente);
  });

  private agruparParaCatalogo(productos: ProductoPOS[]): CatalogoItem[] {
    const items: CatalogoItem[] = [];
    const templateMap = new Map<string, CatalogoItem & { tipo: 'template' }>();

    for (const p of productos) {
      if (!p.producto_template_id) {
        items.push({ tipo: 'simple', producto: p });
        continue;
      }

      const existing = templateMap.get(p.producto_template_id);
      if (existing) {
        existing.variantes.push(p);
      } else {
        const atributos = (p.producto_template?.template_atributos ?? [])
          .map(ta => ta.atributo?.nombre)
          .filter((n): n is string => !!n);

        const item: CatalogoItem & { tipo: 'template' } = {
          tipo: 'template',
          templateId: p.producto_template_id,
          templateNombre: p.producto_template?.nombre ?? p.nombre,
          templateImagenUrl: p.producto_template?.imagen_url,
          templateAtributos: atributos,
          variantes: [p],
        };
        templateMap.set(p.producto_template_id, item);
        items.push(item);
      }
    }

    return items;
  }

  readonly carritoCountMap = computed(() =>
    this.carrito().reduce((map, item) => {
      map[item.id] = (map[item.id] || 0) + item.cantidad;
      return map;
    }, {} as Record<string, number>)
  );

  /** Suma de artículos en carrito agrupados por template_id — para el badge de cards de variantes. */
  readonly templateCountMap = computed(() =>
    this.carrito().reduce((map, item) => {
      if (item.producto_template_id) {
        map[item.producto_template_id] = (map[item.producto_template_id] || 0) + item.cantidad;
      }
      return map;
    }, {} as Record<string, number>)
  );

  readonly subtotalBruto = computed(() =>
    this.carrito().reduce((sum, item) => sum + item.subtotal, 0)
  );

  readonly descuentoAplicado = computed(() => {
    if (!this.appConfig?.pos_descuentos_habilitados) return 0;
    if (this.subtotalBruto() < this.appConfig.pos_umbral_monto_descuento) return 0;
    return Math.round(this.subtotalBruto() * (this.appConfig.pos_descuento_maximo_pct / 100) * 100) / 100;
  });

  readonly totalPagar = computed(() =>
    Math.round((this.subtotalBruto() - this.descuentoAplicado()) * 100) / 100
  );

  get descuentoPct(): number { return this.appConfig?.pos_descuento_maximo_pct ?? 0; }
  get descuentoActivo(): boolean { return !!this.appConfig?.pos_descuentos_habilitados; }

  readonly faltaParaDescuento = computed(() => {
    if (!this.descuentoActivo) return 0;
    const falta = this.appConfig!.pos_umbral_monto_descuento - this.subtotalBruto();
    return falta > 0 ? Math.round(falta * 100) / 100 : 0;
  });

  readonly mostrarUpselling = computed(() => {
    if (!this.descuentoActivo || this.carrito().length === 0) return false;
    const umbral = this.appConfig!.pos_umbral_monto_descuento;
    const falta = this.faltaParaDescuento();
    return falta > 0 && falta <= umbral * 0.3;
  });

  // ── Desglose fiscal (solo FACTURA) — un único reduce sobre el carrito ──
  private readonly _ivaDivisor = computed(() => 1 + (this.appConfig?.pos_iva_porcentaje ?? 15) / 100);
  private readonly _factorDescuento = computed(() =>
    this.subtotalBruto() > 0 ? this.totalPagar() / this.subtotalBruto() : 1
  );
  private readonly _brutosDesglose = computed(() =>
    this.carrito().reduce(
      (acc, i) => {
        if (i.tiene_iva) acc.conIva += i.subtotal;
        else acc.sinIva += i.subtotal;
        return acc;
      },
      { sinIva: 0, conIva: 0 }
    )
  );

  readonly baseIva0 = computed(() =>
    Math.round(this._brutosDesglose().sinIva * this._factorDescuento() * 100) / 100
  );
  readonly baseIva15 = computed(() =>
    Math.round((this._brutosDesglose().conIva * this._factorDescuento() / this._ivaDivisor()) * 100) / 100
  );
  readonly ivaValor = computed(() =>
    Math.round((this.totalPagar() - this.baseIva0() - this.baseIva15()) * 100) / 100
  );
  readonly subtotalNeto = computed(() => Math.round((this.baseIva0() + this.baseIva15()) * 100) / 100);

  get mostrarDesglose(): boolean { return this.tipoComprobante === TipoComprobante.FACTURA && this.ivaValor() > 0; }


  async abrirSelectorCliente() {
    if (this.errorCliente) {
      await this.cargarCliente();
      // Sin red el banner global ya avisa del offline — no repetir con toast.
      if (this.errorCliente && this.network.isConnected()) {
        this.ui.showToast('No se pudo cargar el cliente. Verifica tu conexión.', 'danger');
      }
      return;
    }

    if (this.sinConsumidorFinal) {
      // No hay consumidor final en BD — abrir modal para seleccionar o crear un cliente
      const modal = await this.modalCtrl.create({
        component: SeleccionarClienteModalComponent,
        componentProps: {
          tipoComprobante: this.tipoComprobante,
          clienteActual: null
        }
      });
      await modal.present();
      const { data } = await modal.onDidDismiss();
      if (data?.cliente) {
        this.clienteSeleccionado = data.cliente;
        this.sinConsumidorFinal = false;
        this.cdr.markForCheck();
      }
      return;
    }

    const modal = await this.modalCtrl.create({
      component: SeleccionarClienteModalComponent,
      componentProps: {
        tipoComprobante: this.tipoComprobante,
        clienteActual: this.clienteSeleccionado
      }
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data?.cliente) {
      this.clienteSeleccionado = data.cliente;
      this.cdr.markForCheck();
    }
  }

  async agregarAlCarrito(producto: ProductoPOS, presentacion?: ProductoPresentacion): Promise<boolean> {
    // PESO: si ya está en carrito, editar; si no, agregar nuevo
    if (producto.tipo_venta === 'PESO') {
      const existePeso = this.carrito().find(item => item.id === producto.id);
      if (existePeso) {
        await this.editarCantidad(existePeso);
      } else {
        await this.pedirCantidadPeso(producto);
      }
      return true;
    }

    const stockBase = producto.stock_actual;
    const factor = presentacion?.factor_conversion ?? 1;
    const precioVenta = presentacion?.precio_venta ?? producto.precio_venta;
    const stockUsado = this.stockUsadoPorProducto(producto.id);
    const stockLibre = stockBase - stockUsado;
    const maxUnidades = Math.floor(stockLibre / factor);

    const existe = this.carrito().find(item =>
        item.id === producto.id &&
        item.presentacion_id === (presentacion?.id ?? undefined)
    );

    if (existe) {
      const stockLibreSinEste = stockBase - stockUsado + (existe.cantidad * factor);
      const maxParaEste = Math.floor(stockLibreSinEste / factor);
      if (existe.cantidad < maxParaEste) {
        navigator.vibrate?.(18);
        this.incrementar(existe);
        this.triggerIncrementAnimation(existe);
        this.dispararAnimacionPanel(existe.id + (presentacion?.id ?? ''));
        this.feedbackEscaneo(existe.id);
        this.scrollToBottom();
        return true;
      } else {
        this.ui.showToast('Stock insuficiente', 'warning');
        return false;
      }
    } else {
      if (maxUnidades > 0) {
        const prod = await this.resolverImagen(producto, presentacion);
        const item: CartItem = {
          ...prod,
          precio_venta: precioVenta,
          cantidad: 1,
          subtotal: precioVenta,
          stock_disponible: stockBase,
          ...(presentacion ? {
            presentacion_id: presentacion.id,
            presentacion_nombre: presentacion.nombre,
            factor_conversion: presentacion.factor_conversion
          } : {})
        };
        this.carrito.update(c => [...c, item]);
        const addedKey = producto.id + (presentacion?.id ?? '');
        this.lastAddedKey = addedKey;
        this.cdr.markForCheck();
        setTimeout(() => { this.lastAddedKey = null; this.cdr.markForCheck(); }, 600);
        this.dispararAnimacionPanel(addedKey);
        this.feedbackEscaneo(producto.id);
        this.scrollToBottom();
        return true;
      } else {
        this.ui.showToast('Producto sin stock', 'danger');
        return false;
      }
    }
  }

  private async resolverImagen(producto: ProductoPOS, presentacion?: ProductoPresentacion): Promise<ProductoPOS> {
    // Fallback chain: presentacion.imagen_url → producto.imagen_url → template.imagen_url
    const skuPath = presentacion?.imagen_url || producto.imagen_url || producto.producto_template?.imagen_url;
    const templateRawPath = producto.producto_template?.imagen_url;
    const presRawPaths = (producto.presentaciones ?? []).map(p => p.imagen_url ?? null);

    // Resolve SKU, template and all presentation images in parallel
    const [url, templateUrl, ...presUrls] = await Promise.all([
      this.storageService.resolveImageUrl(skuPath),
      templateRawPath ? this.storageService.resolveImageUrl(templateRawPath) : Promise.resolve(null),
      ...presRawPaths.map(path => this.storageService.resolveImageUrl(path)),
    ]);

    const result: ProductoPOS = { ...producto, imagen_url: url ?? undefined };
    if (result.producto_template) {
      result.producto_template = { ...result.producto_template, imagen_url: templateUrl ?? undefined };
    }
    if (result.presentaciones?.length) {
      result.presentaciones = result.presentaciones.map((p, i) => ({
        ...p,
        imagen_url: presUrls[i] ?? null,
      }));
    }
    return result;
  }

  /** Calcula cuantas unidades base de un producto estan comprometidas en el carrito */
  private stockUsadoPorProducto(productoId: string): number {
    return this.carrito()
        .filter(i => i.id === productoId)
        .reduce((sum, i) => sum + i.cantidad * (i.factor_conversion ?? 1), 0);
  }

  /** Modal para ingresar cantidad (granel o unidad) al agregar un producto nuevo */
  private async pedirCantidadPeso(producto: ProductoPOS, itemExistente?: CartItem) {
    const yaEnCarrito = itemExistente ? itemExistente.cantidad : 0;
    const disponible = producto.stock_actual - yaEnCarrito;
    if (disponible <= 0) {
      this.ui.showToast('Stock insuficiente', 'warning');
      return;
    }

    const modal = await this.modalCtrl.create({
      component: CantidadModalComponent,
      componentProps: {
        nombre: producto.nombre,
        precioUnitario: producto.precio_venta,
        unidadMedida: producto.unidad_medida,
        esPeso: true,
        stockDisponible: disponible,
        cantidadActual: yaEnCarrito,
        esEdicion: !!itemExistente,
        imagenUrl: itemExistente?.imagen_url ?? producto.imagen_url
      },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      backdropDismiss: false
    });

    await modal.present();
    const { data, role } = await modal.onDidDismiss<CantidadModalResult>();
    if (role !== 'confirm' || !data) return;

    const cantRedondeada = data.cantidad;
    if (itemExistente) {
      this.carrito.update(c => c.map(i => i === itemExistente
        ? { ...i, cantidad: i.cantidad + cantRedondeada, subtotal: Math.round((i.cantidad + cantRedondeada) * i.precio_venta * 100) / 100 }
        : i
      ));
    } else {
      const prod = await this.resolverImagen(producto);
      this.carrito.update(c => [...c, {
        ...prod,
        cantidad: cantRedondeada,
        subtotal: Math.round(cantRedondeada * (prod.precio_venta) * 100) / 100,
        stock_disponible: producto.stock_actual
      }]);
      this.lastAddedKey = producto.id;
      this.cdr.markForCheck();
      setTimeout(() => { this.lastAddedKey = null; this.cdr.markForCheck(); }, 600);
    }
    this.feedbackEscaneo(producto.id);
    this.scrollToBottom();
  }

  private scrollToBottom() {
    if (this.vistaActual === 'catalogo') return;
    setTimeout(async () => {
      const content = this.content;
      if (!content) return;
      const scroll = await content.getScrollElement();
      content.scrollToPoint(0, scroll.scrollHeight, 300);
    }, 100);
  }

  /** Agrega N unidades de un producto al carrito (para patrón cantidad*codigo) */
  async agregarAlCarritoConCantidad(producto: ProductoPOS, cantidad: number, presentacion?: ProductoPresentacion) {
    const stockBase = producto.stock_actual;
    const factor = presentacion?.factor_conversion ?? 1;
    const precioVenta = presentacion?.precio_venta ?? producto.precio_venta;

    const stockUsado = this.stockUsadoPorProducto(producto.id);
    const stockLibre = stockBase - stockUsado;
    const maxUnidades = Math.floor(stockLibre / factor);

    if (maxUnidades <= 0) {
      this.ui.showToast('Producto sin stock', 'danger');
      return;
    }

    const existe = this.carrito().find(item =>
        item.id === producto.id &&
        item.presentacion_id === (presentacion?.id ?? undefined)
    );

    const stockLibreConEste = existe ? stockLibre + (existe.cantidad * factor) : stockLibre;
    const maxParaEste = Math.floor(stockLibreConEste / factor);
    const yaEnCarrito = existe ? existe.cantidad : 0;
    const cantidadReal = Math.min(cantidad, maxParaEste - yaEnCarrito);

    if (cantidadReal <= 0) {
      this.ui.showToast('Stock insuficiente', 'warning');
      return;
    }

    if (existe) {
      this.carrito.update(c => c.map(i => i === existe
        ? { ...i, cantidad: i.cantidad + cantidadReal, subtotal: Math.round((i.cantidad + cantidadReal) * i.precio_venta * 100) / 100 }
        : i
      ));
    } else {
      const prod = await this.resolverImagen(producto, presentacion);
      const item: CartItem = {
        ...prod,
        precio_venta: precioVenta,
        cantidad: cantidadReal,
        subtotal: Math.round(cantidadReal * precioVenta * 100) / 100,
        stock_disponible: stockBase,
        ...(presentacion ? {
          presentacion_id: presentacion.id,
          presentacion_nombre: presentacion.nombre,
          factor_conversion: presentacion.factor_conversion
        } : {})
      };
      this.carrito.update(c => [...c, item]);
      this.lastAddedKey = producto.id + (presentacion?.id ?? '');
      this.cdr.markForCheck();
      setTimeout(() => { this.lastAddedKey = null; this.cdr.markForCheck(); }, 600);
    }

    if (cantidadReal < cantidad) {
      this.ui.showToast(`Solo se agregaron ${cantidadReal} (stock máximo)`, 'warning');
    }

    this.feedbackEscaneo(producto.id);
    this.scrollToBottom();
  }

  private triggerIncrementAnimation(item: CartItem) {
    const key = item.id + (item.presentacion_id ?? '');
    this.lastIncrementedKey = key;
    this.cdr.markForCheck();
    setTimeout(() => { this.lastIncrementedKey = null; this.cdr.markForCheck(); }, 350);
  }

  /** Vibración + beep + preview efímero al agregar producto (feedback para escáner) */
  private feedbackEscaneo(productoId: string) {
    if (this.escaneando) {
      this.barcodeScanner.feedback();

      // Mostrar preview del producto escaneado (2.5s)
      const item = this.carrito().find(i => i.id === productoId);
      if (item) {
        clearTimeout(this.scanPreviewTimeout);
        this.scanPreview = { nombre: item.nombre, cantidad: item.cantidad, subtotal: item.subtotal, precioUnitario: item.precio_venta };
        this.cdr.markForCheck();
        this.scanPreviewTimeout = setTimeout(() => { this.scanPreview = null; this.cdr.markForCheck(); }, 2500);
      }
    }
  }

  incrementar(item: CartItem): boolean {
    if (item.tipo_venta === 'PESO') { this.editarCantidad(item); return true; }
    const factor = item.factor_conversion ?? 1;
    const stockUsado = this.stockUsadoPorProducto(item.id);
    const maxParaEste = Math.floor((item.stock_disponible - stockUsado + item.cantidad * factor) / factor);
    if (item.cantidad < maxParaEste) {
      const nuevaCantidad = item.cantidad + 1;
      this.carrito.update(c => c.map(i => i === item
        ? { ...i, cantidad: nuevaCantidad, subtotal: Math.round(nuevaCantidad * i.precio_venta * 100) / 100 }
        : i
      ));
      this.triggerIncrementAnimation(item);
      return true;
    } else {
      this.ui.showToast('Máximo stock alcanzado', 'warning');
      return false;
    }
  }

  decrementar(item: CartItem) {
    if (item.tipo_venta === 'PESO') { this.editarCantidad(item); return; }
    if (item.cantidad > 1) {
      const nuevaCantidad = item.cantidad - 1;
      this.carrito.update(c => c.map(i => i === item
        ? { ...i, cantidad: nuevaCantidad, subtotal: Math.round(nuevaCantidad * i.precio_venta * 100) / 100 }
        : i
      ));
    } else {
      this.eliminar(item);
    }
  }

  async editarCantidad(item: CartItem): Promise<number | null> {
    const itemKey = item.id + (item.presentacion_id ?? '');
    if (this.editandoItemKey === itemKey) return null; // evitar doble tap
    this.editandoItemKey = itemKey;
    this.cdr.markForCheck();

    const esPeso = item.tipo_venta === 'PESO';
    const factor = item.factor_conversion ?? 1;
    const stockUsadoOtros = this.carrito()
        .filter(i => i.id === item.id && i !== item)
        .reduce((sum, i) => sum + i.cantidad * (i.factor_conversion ?? 1), 0);

    try {
      // Consultar stock fresco de BD — garantiza número correcto aunque haya latencia
      const stockFresco = await this.inventarioService.obtenerStockActual(item.id);
      if (stockFresco !== null && stockFresco !== item.stock_disponible) {
        this.carrito.update(items =>
          items.map(i => i === item ? { ...i, stock_disponible: stockFresco } : i)
        );
        item = { ...item, stock_disponible: stockFresco };
      }
    } finally {
      this.editandoItemKey = null;
      this.cdr.markForCheck();
    }

    const maxStock = Math.floor((item.stock_disponible - stockUsadoOtros) / factor);

    const modal = await this.modalCtrl.create({
      component: CantidadModalComponent,
      componentProps: {
        nombre: item.presentacion_nombre ? `${item.nombre} (${item.presentacion_nombre})` : item.nombre,
        precioUnitario: item.precio_venta,
        unidadMedida: item.unidad_medida,
        esPeso,
        stockDisponible: maxStock,
        cantidadActual: item.cantidad,
        esEdicion: true,
        imagenUrl: item.imagen_url
      },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      backdropDismiss: false
    });

    await modal.present();
    const { data, role } = await modal.onDidDismiss<CantidadModalResult>();

    if (role === 'quitar') {
      this.eliminar(item);
      return 0; // 0 indica al caller que el item fue eliminado — debe limpiar su contador
    }

    if (role !== 'confirm' || !data) return null;

    const cantidad = data.cantidad;
    this.carrito.update(c => c.map(i => i === item
      ? { ...i, cantidad, subtotal: Math.round(cantidad * i.precio_venta * 100) / 100 }
      : i
    ));
    return cantidad;
  }

  eliminar(item: CartItem) {
    this.carrito.update(c => c.filter(i => i !== item));
  }


  // ==========================
  // BÚSQUEDA Y ESCÁNER (MANUAL)
  // ==========================

  toggleModoBusqueda() {
    this.modoBusqueda = this.modoBusqueda === 'codigo' ? 'nombre' : 'codigo';
    this.buscarTexto.set('');
    this.productosBusqueda = [];
    this.cdr.markForCheck();
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.cat-search-input');
      input?.focus();
    }, 50);
  }

  limpiarBusqueda() {
    this.buscarTexto.set('');
    this.productosBusqueda = [];
    this.cdr.markForCheck();
  }

  limpiarInputBusqueda() {
    this.buscarTexto.set('');
    this.productosBusqueda = [];
    this.cdr.markForCheck();
    setTimeout(() => {
      document.querySelector<HTMLInputElement>('.cat-search-input')?.focus();
    }, 0);
  }

  // Dispatcher: según el modo activo llama a la lógica correspondiente
  private searchDebounce: ReturnType<typeof setTimeout> | undefined;
  onSearchInput(event: Event) {
    const texto = (event.target as HTMLInputElement).value?.trim();

    if (this.modoBusqueda === 'nombre') return; // el grid filtra reactivamente via buscarTexto signal

    clearTimeout(this.searchDebounce);
    if (!texto) return;
    const esBulk = /^(\d+)\.(.+)$/.test(texto);
    if (!esBulk && texto.length < 8) return;
    this.searchDebounce = setTimeout(() => this.buscarPorCodigo(texto), 300);
  }

  // Enter en modo código dispara búsqueda (pistola lectora envía Enter al final)
  onSearchKeyup(event: KeyboardEvent) {
    if (this.modoBusqueda === 'codigo' && event.key === 'Enter') {
      clearTimeout(this.searchDebounce);
      const texto = this.buscarTexto().trim();
      if (texto) this.buscarPorCodigo(texto);
    }
  }


  private async buscarPorCodigo(texto: string) {
    // Sin red: continuar solo si hay catálogo cacheado. El InventarioService
    // resuelve la búsqueda en memoria (modo offline). Sin cache = no hay nada que buscar.
    if (!this.network.isConnected() && !(await this.catalogoLocal.tieneCache())) {
      this.ui.showToast('Sin conexión y sin catálogo disponible', 'danger');
      return;
    }

    const version = ++this.searchVersion;
    this.buscando = true;
    this.cdr.markForCheck();
    try {
      // Patrón cantidad.codigo (ej: 20.7891234 = 20 unidades del código "7891234")
      const matchRapido = texto.match(/^(\d+)\.(.+)$/);
      if (matchRapido) {
        const cantidad = parseInt(matchRapido[1], 10);
        const codigo = matchRapido[2].trim();
        if (cantidad > 0 && codigo) {
          const resultado = await this.inventarioService.buscarPorCodigoBarras(codigo);
          if (version !== this.searchVersion) return;
          if (resultado) {
            await this.agregarAlCarritoConCantidad(resultado.producto, cantidad, resultado.presentacion);
            this.buscarTexto.set('');
          } else {
            this.ui.showToast(`Código "${codigo}" no encontrado`, 'warning');
          }
        }
        return;
      }

      // Código exacto — se agrega directo sin confirmación
      const resultado = await this.inventarioService.buscarPorCodigoBarras(texto);
      if (version !== this.searchVersion) return;
      if (resultado) {
        await this.agregarAlCarrito(resultado.producto, resultado.presentacion);
        this.buscarTexto.set('');
      } else {
        this.ui.showToast(`Código "${texto}" no encontrado`, 'warning');
      }
    } finally {
      if (version === this.searchVersion) {
        this.buscando = false;
        this.cdr.markForCheck();
      }
    }
  }

  // Clic en la lista de sugerencias — despacha según tipo de resultado
  async seleccionarResultadoBusqueda(resultado: ResultadoBusquedaPOS, limpiar = true) {
    if (resultado.tipo === 'template') {
      await this.mostrarSelectorVariantes(resultado.templateNombre, resultado.variantes);
    } else {
      await this.seleccionarProductoBusqueda(resultado.producto, limpiar);
    }
    if (limpiar) {
      this.limpiarBusqueda();
    }
  }

  async seleccionarProductoBusqueda(producto: ProductoPOS, limpiar = true) {
    const presentaciones = producto.presentaciones ?? [];

    if (presentaciones.length === 0) {
      await this.agregarAlCarrito(producto);
    } else {
      await this.mostrarSelectorPresentacion(producto, presentaciones);
    }

    if (limpiar) {
      this.limpiarBusqueda();
    }
  }

  /** Modal unificado de variantes con presentaciones inline y taps múltiples. */
  private async mostrarSelectorVariantes(templateNombre: string, variantes: ProductoPOS[], subtitle?: string) {
    const resolverItem = (data: VarianteSelectorResult) => {
      const variante = variantes.find(v => v.id === data.varianteId);
      if (!variante) return null;
      const pres = data.presentacionId
        ? variante.presentaciones?.find(p => p.id === data.presentacionId)
        : undefined;
      const item = this.carrito().find(i =>
        i.id === data.varianteId && i.presentacion_id === (data.presentacionId ?? undefined)
      );
      return { variante, pres, item };
    };

    const onAgregar = async (data: VarianteSelectorResult): Promise<boolean> => {
      const r = resolverItem(data);
      if (!r) return false;
      return this.agregarAlCarrito(r.variante, r.pres);
    };

    const onIncrementar = async (data: VarianteSelectorResult): Promise<boolean> => {
      const r = resolverItem(data);
      if (!r?.item) return false;
      return this.incrementar(r.item);
    };

    const onDecrementar = async (data: VarianteSelectorResult) => {
      const r = resolverItem(data);
      if (!r?.item) return;
      this.decrementar(r.item);
    };

    const onEditarCantidad = async (data: VarianteSelectorResult): Promise<number | null> => {
      const r = resolverItem(data);
      if (!r?.item) return null;
      return this.editarCantidad(r.item);
    };

    const modal = await this.modalCtrl.create({
      component: VarianteSelectorModalComponent,
      componentProps: {
        templateNombre,
        subtitle: subtitle ?? `Selecciona una opción de ${templateNombre}`,
        variantes,
        onAgregar,
        onIncrementar,
        onDecrementar,
        onEditarCantidad,
        carritoActual: this.carrito(),
        totalCarrito: this.totalPagar,
        totalArticulosCarrito: this.totalArticulos
      },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });

    await modal.present();
    await modal.onDidDismiss();
  }

  /** Modal de presentaciones para productos simples — reutiliza el mismo modal de variantes. */
  private async mostrarSelectorPresentacion(producto: ProductoPOS, presentaciones: ProductoPresentacion[]) {
    await this.mostrarSelectorVariantes(producto.nombre, [producto], 'Selecciona cómo venderlo');
  }

  // ==========================
  // ESCÁNER FÍSICO (PISTOLA USB/BT)
  // ==========================
  @HostListener('document:keypress', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    // Ignorar si la página no está activa (Ionic cachea páginas)
    if (!this.paginaActiva) return;

    // Si el usuario ya está enfocado en un input (ej. el searchbar), ignoramos
    // para no duplicar el evento.
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'ION-INPUT' || target.tagName === 'ION-SEARCHBAR') {
      return;
    }

    if (event.key === 'Enter') {
      // Si recibimos un Enter y el buffer tiene algo (ej. EAN típico de 8 a 13 digitos)
      if (this.barcodeBuffer.length > 3) {
        void this.procesarCodigoRapido(this.barcodeBuffer);
      }
      this.barcodeBuffer = '';
    } else {
      if (event.key.length === 1) { // Evitamos Shift, Ctrl, etc.
        this.barcodeBuffer += event.key;
        clearTimeout(this.barcodeTimeout);
        // Las pistolas USB escriben ~5-20ms por tecla. 
        // 100ms es seguro para resetear si fue tipeo humano lento.
        this.barcodeTimeout = setTimeout(() => {
          this.barcodeBuffer = '';
        }, 100);
      }
    }
  }

  async procesarCodigoRapido(codigo: string) {
    // Sin red: continuar solo si hay catálogo cacheado.
    if (!this.network.isConnected() && !(await this.catalogoLocal.tieneCache())) {
      this.ui.showToast('Sin conexión y sin catálogo disponible', 'danger');
      return;
    }

    try {
      const resultado = await this.inventarioService.buscarPorCodigoBarras(codigo);
      if (resultado) {
        await this.agregarAlCarrito(resultado.producto, resultado.presentacion);
      } else {
        this.ui.showToast(`EAN ${codigo} no encontrado en catálogo`, 'warning');
      }
    } catch {
      this.ui.showToast('Error de conexión. Verifica tu internet.', 'danger');
    }
  }

  async abrirEscanerCamara() {
    this.escaneando = true;
    this.cdr.markForCheck();
    const iniciado = await this.barcodeScanner.startContinuous((codigo) => {
      if (this.procesandoEscaneo) return;

      // Anti-duplicados: ignora el mismo código dentro de 800ms
      const ahora = Date.now();
      if (codigo === this.ultimoCodigoEscaneado && ahora - this.ultimoTiempoEscaneado < 800) return;

      this.procesandoEscaneo = true;
      this.ultimoCodigoEscaneado = codigo;
      this.ultimoTiempoEscaneado = ahora;

      (async () => {
        try {
          await this.procesarCodigoRapido(codigo);
        } finally {
          this.procesandoEscaneo = false;
        }
      })();
    });

    if (!iniciado) { this.escaneando = false; this.cdr.markForCheck(); }
  }

  async cerrarEscaner() {
    await this.barcodeScanner.stop();
    this.escaneando = false;
    this.scanPreview = null;
    clearTimeout(this.scanPreviewTimeout);
    this.cdr.markForCheck();
  }

  async cobrarEfectivo() {
    await this.abrirModalCobro(true);
  }

  async cobrar() {
    await this.abrirModalCobro(false);
  }

  private async abrirModalCobro(iniciarEnEfectivo: boolean) {
    if (this.carrito().length === 0 || this.cobroEnProceso) return;

    if (!this.clienteSeleccionado?.id) {
      this.ui.showToast('Cliente no cargado. Toca el cliente para actualizar.', 'warning');
      return;
    }

    if (this.tipoComprobante === TipoComprobante.FACTURA && this.clienteSeleccionado.es_consumidor_final) {
      this.ui.showToast('La Factura requiere seleccionar un cliente con RUC o cédula', 'warning');
      return;
    }

    const onSeleccionarCliente = async (): Promise<Cliente | null> => {
      await this.abrirSelectorCliente();
      return this.clienteSeleccionado;
    };

    const modal = await this.modalCtrl.create({
      component: CobrarModalComponent,
      componentProps: {
        total: this.totalPagar(),
        subtotal: this.subtotalBruto(),
        descuento: this.descuentoAplicado(),
        descuentoPct: this.descuentoPct,
        totalArticulos: this.totalArticulos(),
        esConsumidorFinal: this.clienteSeleccionado?.es_consumidor_final ?? true,
        iniciarEnEfectivo,
        onSeleccionarCliente
      },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      backdropDismiss: false
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data?.confirmado) this.ejecutarCobro(data.metodoPago);
  }

  private async mostrarAlertSinTurno() {
    const alert = await this.alertCtrl.create({
      header: 'Caja Chica cerrada',
      message: 'Debes abrir la Caja Chica antes de registrar ventas.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Ir a Inicio',
          handler: () => this.router.navigate([ROUTES.home])
        }
      ]
    });
    await alert.present();
  }

  private static readonly IDEMPOTENCY_STORAGE_KEY = 'pos_pending_idempotency_key';

  private async ejecutarCobro(metodoPago: string) {
    if (this.cobroEnProceso) return;
    this.cobroEnProceso = true;
    this.cdr.markForCheck();

    // 1. Generar idempotency key y persistir ANTES de cualquier intento (online u offline)
    const idempotencyKey = crypto.randomUUID();
    localStorage.setItem(PosPage.IDEMPOTENCY_STORAGE_KEY, idempotencyKey);

    // 2. Armar el payload con todos los campos fiscales correctos
    //    FIADO no lleva descuento — son beneficios mutuamente excluyentes
    const esFiado = metodoPago === 'FIADO';
    const descuento = esFiado ? 0 : this.descuentoAplicado();
    const descuentoPct = esFiado ? 0 : this.descuentoPct;
    const totalFinal = esFiado ? this.subtotalBruto() : this.totalPagar();
    const esFactura = this.tipoComprobante === TipoComprobante.FACTURA;
    const payload: VentaPayload = {
      total:             totalFinal,
      subtotal:          esFactura ? this.subtotalNeto() : this.subtotalBruto(),
      descuento,
      descuentoPct,
      metodoPago,
      tipoComprobante:   this.tipoComprobante,
      clienteId:         this.clienteSeleccionado?.id,
      baseIva0:          esFactura ? this.baseIva0()  : 0,
      baseIva15:         esFactura ? this.baseIva15() : 0,
      ivaValor:          esFactura ? this.ivaValor()  : 0,
      idempotencyKey,
    };

    // 3. Offline: FIADO y FACTURA no están soportados (requieren el servidor — §3 del plan).
    //    El resto se encola local-first y se sincroniza al volver la red.
    if (!this.network.isConnected()) {
      if (esFiado || esFactura) {
        localStorage.removeItem(PosPage.IDEMPOTENCY_STORAGE_KEY);
        this.ui.showToast('Fiado y Factura no están disponibles sin conexión', 'warning');
        this.cobroEnProceso = false;
        this.cdr.markForCheck();
        return;
      }
      await this.cobrarOffline(idempotencyKey, payload);
      this.cobroEnProceso = false;
      this.cdr.markForCheck();
      return;
    }

    // 4. Online: flujo directo contra el servidor (muestra número de comprobante real).
    await this.ui.showLoading();
    try {
      const response = await this.posService.procesarVenta(this.carrito(), payload);
      await this.ui.hideLoading();

      if (response.success) {
        localStorage.removeItem(PosPage.IDEMPOTENCY_STORAGE_KEY);
        this.ui.showToast(`Venta #${response.numeroComprobante} registrada`, 'success');
        this.limpiarCarrito();
      } else {
        this.ui.showToast('No se pudo registrar la venta. Intenta de nuevo.', 'danger');
      }
    } catch (error) {
      await this.ui.hideLoading();
      if (error instanceof Error && error.message === 'SIN_TURNO') {
        await this.mostrarAlertSinTurno();
      } else if (error instanceof Error && /stock insuficiente/i.test(error.message)) {
        this.ui.showToast('Stock insuficiente — el catálogo se actualizó con los valores reales', 'warning');
        this.refrescarCatalogo();
        this.logger.warn('PosPage', 'Venta rechazada por stock insuficiente en BD');
      } else {
        const mensaje = error instanceof Error ? error.message : 'Error inesperado al procesar la venta';
        this.ui.showToast(mensaje, 'danger');
        this.logger.error('PosPage', 'Error en proceso de cobro', error);
      }
    } finally {
      this.cobroEnProceso = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Cobro offline (local-first): encola la venta y responde al instante.
   * La venta YA existe en disco al volver este método — el SyncService la sube al
   * volver la red. No espera al servidor ni muestra número de comprobante (lo asigna
   * el servidor al sincronizar). El stock se descontó optimista en el carrito.
   */
  private async cobrarOffline(idempotencyKey: string, payload: VentaPayload) {
    try {
      const encolada = await this.posService.encolarVentaOffline(this.carrito(), payload);
      if (encolada) {
        // La venta está en disco — la idempotency key ya no la maneja localStorage,
        // la cola es la fuente de verdad de lo pendiente.
        localStorage.removeItem(PosPage.IDEMPOTENCY_STORAGE_KEY);
        this.ui.showToast('Venta guardada — se sincronizará al volver la conexión', 'success');
        this.limpiarCarrito();
      } else {
        this.ui.showToast('No se pudo guardar la venta. Intenta de nuevo.', 'danger');
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'SIN_TURNO') {
        await this.mostrarAlertSinTurno();
      } else {
        this.ui.showToast('No se pudo guardar la venta sin conexión.', 'danger');
        this.logger.error('PosPage', 'Error al encolar venta offline', error);
      }
    }
  }

  limpiarCarrito() {
    this.carrito.set([]);
    this.buscarTexto.set('');
    this.productosBusqueda = [];
    if (this.volvioDesdeCatalogo && !this.esDesktop) {
      this.volvioDesdeCatalogo = false;
      this.vistaActual = 'catalogo';
    }
    // Ambos en background — no bloquean el vaciado del carrito
    this.cargarCliente();
    this.refrescarCatalogo();
  }

  // ==========================
  // LIFECYCLE — limpieza de recursos
  // ==========================

  ionViewDidLeave() {
    this.paginaActiva = false;
    this.cobroEnProceso = false;
    this.procesandoEscaneo = false;
    if (this.escaneando) this.cerrarEscaner();
    clearTimeout(this.barcodeTimeout);
    clearTimeout(this.searchDebounce);
    clearTimeout(this.scanPreviewTimeout);
  }

  async ionViewWillEnter() {
    this.paginaActiva = true;
    this.productosBusqueda = [];
    this.buscarTexto.set('');
    this.cdr.markForCheck();
    await Promise.all([
      this.recuperarVentaPendiente(),
      this.refrescarConfig(),
      this.refrescarCatalogo(),
    ]);
  }

  /** Refresca config silenciosamente al volver al POS (ej: admin cambió descuentos) */
  private async refrescarConfig() {
    this.configService.invalidar();
    this.appConfig = await this.configService.get();
    this.cdr.markForCheck();
  }

  /** Refresca el catálogo silenciosamente sin spinner ni pérdida del carrito.
   *  Reutiliza el pintado progresivo (stock fresco al instante, imágenes en background)
   *  y sincroniza el stock de los ítems del carrito con los valores frescos. */
  private async refrescarCatalogo() {
    try {
      const [categorias, productos] = await Promise.all([
        this.inventarioService.obtenerCategorias(),
        this.inventarioService.obtenerProductosCatalogoPOS(this.categoriaActivaId ?? undefined, undefined)
      ]);
      this.categoriasCatalogo = categorias;
      this.publicarCatalogoConImagenesProgresivas(productos);
      this.sincronizarStockCarrito(productos);
    } catch {
      // Silencioso — si falla la red el catálogo anterior sigue visible
    }
  }

  /** Actualiza stock_disponible de los ítems del carrito con el stock fresco de BD.
   *  Garantiza que CantidadModal y la vista lista muestren el número correcto. */
  private sincronizarStockCarrito(productosFrescos: ProductoPOS[]) {
    const stockMap = new Map(productosFrescos.map(p => [p.id, p.stock_actual]));
    const carritoActual = this.carrito();
    const hayDiferencia = carritoActual.some(
      item => stockMap.has(item.id) && stockMap.get(item.id) !== item.stock_disponible
    );
    if (!hayDiferencia) return;
    this.carrito.update(items =>
      items.map(item => {
        const stockFresco = stockMap.get(item.id);
        if (stockFresco === undefined || stockFresco === item.stock_disponible) return item;
        return { ...item, stock_disponible: stockFresco };
      })
    );
  }

  /** Pull-to-refresh: recarga config y catálogo sin perder el carrito */
  async handleRefresh(event: CustomEvent) {
    await Promise.all([this.refrescarConfig(), this.refrescarCatalogo()]);
    (event.target as HTMLIonRefresherElement).complete();
  }

  /**
   * Si la app se cerró o la página se fue durante un cobro,
   * verifica si quedó una idempotency_key sin limpiar.
   * Si la venta ya se registró en BD → limpia carrito + key.
   * Si no existe → limpia solo la key (el usuario reintentará).
   */
  private async recuperarVentaPendiente() {
    const pendingKey = localStorage.getItem(PosPage.IDEMPOTENCY_STORAGE_KEY);
    if (!pendingKey) return;

    try {
      const { data } = await this.posService.verificarVentaPorIdempotencyKey(pendingKey);
      if (data) {
        // La venta SÍ se registró — limpiar todo
        localStorage.removeItem(PosPage.IDEMPOTENCY_STORAGE_KEY);
        this.ui.showToast('Venta pendiente confirmada exitosamente', 'success');
        this.limpiarCarrito();
      } else {
        // La venta NO se registró — limpiar key para que pueda reintentar con nueva key
        localStorage.removeItem(PosPage.IDEMPOTENCY_STORAGE_KEY);
      }
    } catch {
      // Sin conexión — no hacer nada, se reintentará en el próximo enter
    }
  }

  ngOnDestroy() {
    if (this.escaneando) this.cerrarEscaner();
    clearTimeout(this.barcodeTimeout);
    clearTimeout(this.searchDebounce);
    clearTimeout(this.scanPreviewTimeout);
  }

}
