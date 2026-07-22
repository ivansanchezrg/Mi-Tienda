import { Component, ElementRef, HostListener, inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AlertController, ModalController, NavController,
  IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonButton, IonIcon,
  IonContent, IonRefresher, IonRefresherContent,
  IonList, IonItem, IonLabel, IonSkeletonText,
  IonInfiniteScroll, IonInfiniteScrollContent, IonFab, IonFabButton, IonSpinner,
  ViewWillEnter, ViewDidLeave
} from '@ionic/angular/standalone';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { OptionsMenuComponent, MenuOption } from '../../../../shared/components/options-menu/options-menu.component';
import { Subscription } from 'rxjs';
import { addIcons } from 'ionicons';
import {
  addOutline,
  imageOutline,
  alertCircleOutline,
  cubeOutline,
  scanOutline,
  searchOutline,
  closeOutline,
  pricetagOutline,
  colorPaletteOutline,
  arrowUpOutline,
  chevronForwardOutline,
  timeOutline,
  createOutline,
  trashOutline,
  checkmarkCircleOutline,
  swapVerticalOutline,
  walletOutline,
  star
} from 'ionicons/icons';
import { BarcodeScannerService } from '../../../../core/services/barcode-scanner.service';
import { PaginatedListPage } from '../../../../shared/pages/paginated-list.page';
import { PAGINATION_CONFIG } from '../../../../core/config/pagination.config';
import { InventarioService, MetricasInventario } from '../../services/inventario.service';
import { ProductoService } from '../../services/producto.service';
import { Producto } from '../../models/producto.model';
import { CategoriaProducto } from '../../models/categoria-producto.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { StorageService } from '../../../../core/services/storage.service';
import { ScannerOverlayComponent } from '../../../../shared/components/scanner-overlay/scanner-overlay.component';
import { AjusteStockModalComponent, AjusteStockResult } from '../../components/ajuste-stock-modal/ajuste-stock-modal.component';
import { LoggerService } from '../../../../core/services/logger.service';
import { ROUTES } from '../../../../core/config/routes.config';

/**
 * Item del grid de inventario en modo "agrupado".
 * - 'simple'   → un producto individual (sin variantes)
 * - 'template' → grupo de variantes del mismo template (camiseta S/M/L × colores)
 */
type InventarioItem =
    | { kind: 'simple'; producto: Producto }
    | {
        kind: 'template';
        templateId: string;
        templateNombre: string;
        // Solo la imagen propia del template (producto_templates.imagen_url) — NUNCA
        // caer a la imagen de una variante como fallback. Si el template no tiene
        // imagen propia, se muestra el placeholder; el usuario la asigna desde el
        // botón lápiz (irAEditarTemplate → TemplateEditarPage).
        templateImagenUrl?: string | null;
        categoriaNombre?: string;
        variantes: Producto[];
        stockTotal: number;
        stockBajo: number;        // variantes con stock <= stock_minimo (y > 0)
        stockAgotado: number;     // variantes con stock = 0
        precioMin: number;
        precioMax: number;
      };

@Component({
  selector: 'app-inventario',
  templateUrl: './inventario.page.html',
  styleUrls: ['./inventario.page.scss'],
  standalone: true,
  imports: [
    FormsModule,
    IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonButton, IonIcon,
    IonSpinner, IonContent, IonRefresher, IonRefresherContent,
    IonList, IonItem, IonLabel, IonSkeletonText,
    IonInfiniteScroll, IonInfiniteScrollContent, IonFab, IonFabButton,
    EmptyStateComponent, ScannerOverlayComponent, OptionsMenuComponent
  ]
})
export class InventarioPage extends PaginatedListPage<Producto> implements OnInit, OnDestroy, ViewWillEnter, ViewDidLeave {
  private inventarioService = inject(InventarioService);
  private productoService = inject(ProductoService);
  protected currencyService = inject(CurrencyService);
  private storageService = inject(StorageService);
  private navCtrl = inject(NavController);
  private alertCtrl = inject(AlertController);
  private modalCtrl = inject(ModalController);
  protected barcodeScanner = inject(BarcodeScannerService);
  private logger = inject(LoggerService);

  @ViewChild('categoriaScroll') categoriaScrollRef!: ElementRef<HTMLDivElement>;

  protected readonly pageSize = PAGINATION_CONFIG.inventario.pageSize;
  readonly loadingMoreText = 'Cargando más productos...';

  categorias: CategoriaProducto[] = [];
  buscarTexto = '';
  categoriaSeleccionada?: string;
  templateSeleccionado?: { id: string; nombre: string };
  escaneando = false;
  mostrarDesactivados = false;
  soloStockBajo = false;
  ajustandoId: string | null = null;
  readonly vistaAgrupada = true;
  readonly skeletonItems = Array(8);

  /** Métricas de cabecera (total, por reponer, agotados, valor). Server-side. */
  metricas: MetricasInventario | null = null;

  // Buffer para pistola lectora física (mismo patrón que el POS) — captura el escaneo
  // cuando NINGÚN input tiene el foco y dispara el mismo flujo que la cámara.
  private barcodeBuffer = '';
  private barcodeTimeout: ReturnType<typeof setTimeout> | undefined;
  /** Evita reentrada mientras un escaneo (alert/navegación) está en curso. */
  private procesandoEscaneoFisico = false;
  /** El @HostListener sigue vivo mientras la página está cacheada (IonicRouteStrategy).
   *  Este flag evita procesar escaneos cuando el usuario está en OTRA página. */
  private paginaActiva = true;

  /**
   * Valor del inventario en formato compacto para caber en la stat-card:
   *   < 10.000  → "1,250.00"  (formato moneda estándar)
   *   >= 10.000 → "12.5k" / "1.2M"  (abreviado, sin saturar la card)
   */
  get valorInventarioCompacto(): string {
    // SUM de DECIMAL puede llegar como string desde Supabase → forzar a número.
    const v = Number(this.metricas?.valor_inventario ?? 0);
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (v >= 10_000)    return (v / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
    return this.currencyService.format(v);
  }

  /** Items derivados para la lista — agrupa por template cuando vistaAgrupada=true */
  get itemsGrid(): InventarioItem[] {
    return this.vistaAgrupada && !this.mostrarDesactivados && !this.soloStockBajo && !this.templateSeleccionado
      ? this.agruparItems(this.items)
      : this.items.map(p => ({ kind: 'simple' as const, producto: p }));
  }

  private agruparItems(productos: Producto[]): InventarioItem[] {
    const items: InventarioItem[] = [];
    const templateMap = new Map<string, Extract<InventarioItem, { kind: 'template' }>>();

    for (const p of productos) {
      if (!p.producto_template_id) {
        items.push({ kind: 'simple', producto: p });
        continue;
      }
      const existing = templateMap.get(p.producto_template_id);
      if (existing) {
        existing.variantes.push(p);
        existing.stockTotal += Number(p.stock_actual) || 0;
        if (Number(p.stock_actual) === 0) existing.stockAgotado++;
        else if (Number(p.stock_actual) <= Number(p.stock_minimo)) existing.stockBajo++;
        existing.precioMin = Math.min(existing.precioMin, Number(p.precio_venta) || 0);
        existing.precioMax = Math.max(existing.precioMax, Number(p.precio_venta) || 0);
      } else {
        const stock = Number(p.stock_actual) || 0;
        const item: Extract<InventarioItem, { kind: 'template' }> = {
          kind: 'template',
          templateId: p.producto_template_id,
          templateNombre: p.producto_template?.nombre ?? p.nombre,
          templateImagenUrl: p.producto_template?.imagen_url,
          categoriaNombre: p.producto_template?.categoria?.nombre ?? p.categoria?.nombre,
          variantes: [p],
          stockTotal: stock,
          stockBajo:    stock > 0 && stock <= Number(p.stock_minimo) ? 1 : 0,
          stockAgotado: stock === 0 ? 1 : 0,
          precioMin: Number(p.precio_venta) || 0,
          precioMax: Number(p.precio_venta) || 0,
        };
        templateMap.set(p.producto_template_id, item);
        items.push(item);
      }
    }
    return items;
  }

  /**
   * Chip resaltado en la barra de filtros. Con texto de búsqueda activo, ningún chip
   * se marca (ni siquiera "Todas") — el catálogo mostrado ya no es "todo sin filtrar",
   * es un resultado de texto, y el chip no debe mentir sobre eso. Vaciar la búsqueda
   * (input, "x", o tocar "Todas") vuelve a landear en el chip que corresponda.
   */
  get filtroSeleccionado(): string {
    if (this.buscarTexto.trim()) return 'buscando';
    if (this.mostrarDesactivados) return 'desactivados';
    if (this.soloStockBajo) return 'reponer';
    if (this.templateSeleccionado) return `tmpl-${this.templateSeleccionado.id}`;
    if (this.categoriaSeleccionada) return `cat-${this.categoriaSeleccionada}`;
    return 'todas';
  }

  private searchDebounce: ReturnType<typeof setTimeout> | undefined;
  private productoChangeSub?: Subscription;

  constructor() {
    super();
    addIcons({
      addOutline,
      imageOutline,
      alertCircleOutline,
      cubeOutline,
      scanOutline,
      searchOutline,
      closeOutline,
      pricetagOutline,
      colorPaletteOutline,
      arrowUpOutline,
      chevronForwardOutline,
      timeOutline,
      createOutline,
      trashOutline,
      checkmarkCircleOutline,
      swapVerticalOutline,
      walletOutline,
      star
    });
  }

  /** Botón "×" del input — solo vacía el texto de búsqueda, sin tocar los filtros de categoría. */
  limpiarBusqueda() {
    this.buscarTexto = '';
    clearTimeout(this.searchDebounce);
    this.cargar();
  }

  onSearchInputNativo(event: Event) {
    const input = event.target as HTMLInputElement;
    this.buscarTexto = input.value ?? '';
    this.aplicarFiltro();
  }

  /** Enter en el buscador (la pistola envía Enter al final): si el texto parece un código
   *  de barras (solo dígitos, ≥8), dispara el mismo flujo que la cámara/pistola global
   *  (crear si es nuevo, alert si existe). Si es texto normal, no hace nada (sigue filtrando). */
  onSearchKeyup(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    const texto = this.buscarTexto.trim();
    if (/^\d{8,}$/.test(texto)) {
      (event.target as HTMLInputElement).blur();
      this.limpiarBusqueda();
      void this.procesarEscaneoFisico(texto);
    }
  }

  async ngOnInit() {
    this.categorias = await this.inventarioService.obtenerCategorias();
    await Promise.all([this.cargar(), this.cargarMetricas()]);

    // Escuchar cambios de producto desde la página de formulario
    this.productoChangeSub = this.inventarioService.onProductoChange$.subscribe(async event => {
      // Toda mutación (crear/ajustar/desactivar) altera alguna métrica → refrescar siempre.
      this.cargarMetricas();

      if (event.tipo === 'RECARGA') {
        this.cargar();
        return;
      }
      if (event.tipo === 'DESACTIVADO') {
        this.items = this.items.filter(p => p.id !== event.producto.id);
        return;
      }
      const producto = await this.resolverImagenUrl(event.producto);
      if (event.tipo === 'CREADO') {
        this.items.unshift(producto);
      } else if (event.tipo === 'ACTUALIZADO') {
        const idx = this.items.findIndex(p => p.id === producto.id);
        if (idx >= 0) {
          this.items[idx] = producto;
        }
      }
    });
  }

  /** Carga (o refresca) las métricas de cabecera. Silenciosa: nunca bloquea la lista. */
  private async cargarMetricas() {
    try {
      this.metricas = await this.inventarioService.obtenerMetricas();
    } catch (e) {
      this.logger.error('InventarioPage', 'Error cargando métricas', e);
    }
  }

  protected async fetchPage(page: number): Promise<Producto[]> {
    if (this.mostrarDesactivados) {
      if (page > 0) return [];
      const productos = await this.inventarioService.obtenerProductosDesactivados();
      return this.resolverImagenesLote(productos);
    }
    const productos = await this.inventarioService.obtenerProductos(
      this.buscarTexto || undefined,
      this.categoriaSeleccionada,
      this.templateSeleccionado?.id,
      page,
      this.pageSize,
      this.soloStockBajo
    );
    return this.resolverImagenesLote(productos);
  }

  /**
   * Búsqueda y filtros son secciones independientes y siempre visibles (no un swap de
   * capas como el patrón POS) — por eso el texto se combina con el filtro de categoría
   * activo en vez de resetearlo. `mostrarDesactivados` y `templateSeleccionado` sí se
   * limpian: son contextos distintos (desactivados no tiene buscador propio; template
   * es "viendo variantes de X", del que buscar texto libre debe sacarte).
   */
  aplicarFiltro() {
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(async () => {
      this.templateSeleccionado = undefined;
      this.mostrarDesactivados = false;
      await this.cargar();
    }, 450);
  }

  /**
   * Tocar cualquier chip (incluida "Todas") es una navegación explícita a un filtro
   * concreto — sale del contexto de búsqueda de texto libre, igual que ya hacía con
   * templateSeleccionado. Sin esto, un chip podía quedar "activo" en apariencia
   * mientras buscarTexto seguía filtrando en silencio (ver filtroSeleccionado).
   */
  onFiltroChange(value: string) {
    this.templateSeleccionado = undefined;
    this.buscarTexto = '';
    clearTimeout(this.searchDebounce);
    if (value === 'desactivados') {
      this.mostrarDesactivados = true;
      this.soloStockBajo = false;
      this.categoriaSeleccionada = undefined;
    } else if (value === 'reponer') {
      this.soloStockBajo = true;
      this.mostrarDesactivados = false;
      this.categoriaSeleccionada = undefined;
    } else if (value === 'todas') {
      this.mostrarDesactivados = false;
      this.soloStockBajo = false;
      this.categoriaSeleccionada = undefined;
    } else if (value.startsWith('cat-')) {
      this.mostrarDesactivados = false;
      this.soloStockBajo = false;
      this.categoriaSeleccionada = value.replace('cat-', '');
    }
    this.cargar();
  }

  /**
   * Tap en una stat-card de métrica → atajo al filtro correspondiente.
   *   'total'    → limpia filtros (muestra todo el catálogo activo)
   *   'reponer'  → filtro Reponer (por reponer y agotados: los agotados encabezan
   *                con badge rojo, así que reponer los cubre — no hace falta un
   *                filtro server-side separado solo para agotados)
   *   'valor'    → informativa pura, sin navegación
   */
  onMetricaTap(metrica: 'total' | 'reponer' | 'valor') {
    if (metrica === 'total') {
      this.onFiltroChange('todas');
    } else if (metrica === 'reponer') {
      this.onFiltroChange('reponer');
    }
  }

  /** Pull-to-refresh: además de la lista, refresca las métricas de cabecera. */
  override async handleRefresh(event: CustomEvent): Promise<void> {
    await Promise.all([this.cargar(true), this.cargarMetricas()]);
    (event.target as HTMLIonRefresherElement).complete();
  }

  filtrarPorTemplate(template: { id: string; nombre: string }, event: MouseEvent) {
    event.stopPropagation();
    this.templateSeleccionado = template;
    this.categoriaSeleccionada = undefined;
    this.mostrarDesactivados = false;
    this.soloStockBajo = false;
    this.buscarTexto = '';
    this.cargar();
  }

  /** Tap en item de template agrupado → muestra las variantes filtradas */
  abrirTemplate(item: Extract<InventarioItem, { kind: 'template' }>) {
    this.templateSeleccionado = { id: item.templateId, nombre: item.templateNombre };
    this.categoriaSeleccionada = undefined;
    this.mostrarDesactivados = false;
    this.soloStockBajo = false;
    this.buscarTexto = '';
    this.cargar();
  }

  limpiarFiltroTemplate() {
    this.templateSeleccionado = undefined;
    this.cargar();
  }

  irACrear() {
    this.navCtrl.navigateForward(ROUTES.inventario.nuevo);
  }

  private irACrearConCodigo(codigoBarras: string) {
    // Sin `tipo` — el usuario elige en el paso 0 cómo se vende (simple / presentaciones / variantes)
    this.navCtrl.navigateForward(ROUTES.inventario.nuevo, { queryParams: { codigo: codigoBarras } });
  }

  /**
   * Resuelve tanto la imagen del SKU como la del template (cuando aplica) — un producto
   * con variantes se muestra en la card agrupada usando producto_template.imagen_url
   * (ver agruparItems), así que dejar ese campo sin resolver rompe el thumbnail tras
   * cualquier evento ACTUALIZADO (favorito, ajuste de stock, etc.) en productos con
   * template. Mismo criterio que resolverImagenesLote (carga inicial de la página).
   */
  private async resolverImagenUrl(producto: Producto): Promise<Producto> {
    const [url, templateUrl] = await Promise.all([
      this.storageService.resolveImageUrl(producto.imagen_url),
      producto.producto_template?.imagen_url
        ? this.storageService.resolveImageUrl(producto.producto_template.imagen_url)
        : Promise.resolve(null)
    ]);
    return {
      ...producto,
      imagen_url: url ?? undefined,
      producto_template: producto.producto_template
        ? { ...producto.producto_template, imagen_url: templateUrl ?? undefined }
        : undefined
    };
  }

  private async resolverImagenesLote(productos: Producto[]): Promise<Producto[]> {
    // Resolver tanto la imagen del SKU como la del template (cuando aplica)
    const productoUrls = productos.map(p => p.imagen_url);
    const templateUrls = productos.map(p => p.producto_template?.imagen_url ?? null);
    const [urls, tUrls] = await Promise.all([
      this.storageService.resolveImageUrls(productoUrls),
      this.storageService.resolveImageUrls(templateUrls.filter((u): u is string => !!u))
    ]);
    // Re-mapear las URLs de template a sus índices originales (compactadas tras el filter)
    const templateUrlMap = new Map<string, string>();
    let ti = 0;
    for (const u of templateUrls) {
      if (u) {
        const resolved = tUrls[ti++];
        if (resolved) templateUrlMap.set(u, resolved);
      }
    }
    return productos.map((p, i) => ({
      ...p,
      imagen_url: urls[i] ?? undefined,
      producto_template: p.producto_template
        ? { ...p.producto_template, imagen_url: p.producto_template.imagen_url ? templateUrlMap.get(p.producto_template.imagen_url) ?? undefined : undefined }
        : undefined
    }));
  }

  irAEditar(producto: Producto) {
    this.navCtrl.navigateForward(ROUTES.inventario.editar(producto.id));
  }

  /** Edita los datos generales del grupo de variantes (nombre, categoría, imagen general). */
  irAEditarTemplate(templateId: string, event: MouseEvent) {
    event.stopPropagation();
    this.navCtrl.navigateForward(ROUTES.inventario.editarTemplate(templateId));
  }

  irAKardex(producto: Producto) {
    this.navCtrl.navigateForward(ROUTES.inventario.kardex(producto.id));
  }

  // ==========================
  // AJUSTE DE STOCK (desde el menú ⋮ del item)
  // ==========================

  /**
   * Abre el modal de ajuste. El modal espera la promesa de `onConfirmar` antes de
   * cerrarse (patrón de PresentacionModalComponent.onConfirmar) — así "Procesando..."
   * es visible de verdad, y si falla el modal sigue abierto con cantidad/observaciones
   * intactas para reintentar.
   *
   * `ajustandoId` marca el item en la lista como "ocupado" (fila atenuada + spinner
   * en el stock, ver inv-item--ajustando en el HTML) mientras la operación está en
   * curso — feedback visual de que el ajuste de ESE producto se está procesando.
   */
  private async abrirModalAjuste(producto: Producto) {
    if (this.ajustandoId) return;

    const modal = await this.modalCtrl.create({
      component: AjusteStockModalComponent,
      componentProps: {
        stockActual:  producto.stock_actual,
        esPeso:       producto.tipo_venta === 'PESO',
        unidadMedida: producto.unidad_medida || 'und',
        onConfirmar: (data: AjusteStockResult) => this.ejecutarAjuste(producto, data)
      },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });
    await modal.present();
  }

  private async ejecutarAjuste(producto: Producto, data: AjusteStockResult): Promise<boolean> {
    this.ajustandoId = producto.id;
    try {
      await this.inventarioService.ajustarStock(producto.id, data.tipo, data.cantidad, data.observaciones);
      // La lista se actualiza vía onProductoChange$:ACTUALIZADO (ver ngOnInit).
      return true;
    } catch (error) {
      this.logger.error('InventarioPage', 'Error ajustando stock', error);
      return false;
    } finally {
      this.ajustandoId = null;
    }
  }

  // ==========================
  // MENÚ ⋮ POR ITEM
  // ==========================

  menuOpcionesProducto(_producto: Producto): MenuOption[] {
    return [
      { label: 'Ajustar stock', icon: 'swap-vertical-outline', value: 'ajustar' },
      { label: 'Ver kárdex',    icon: 'time-outline',          value: 'kardex'  },
      { label: 'Editar',        icon: 'create-outline',        value: 'editar'  },
      { label: 'Desactivar',    icon: 'trash-outline',         value: 'desactivar', color: 'danger' },
    ];
  }

  async onMenuOpcion(opcion: MenuOption, producto: Producto) {
    // El popover (app-options-menu) ya hace stopPropagation en su onSelect.
    switch (opcion.value) {
      case 'ajustar':    await this.abrirModalAjuste(producto); break;
      case 'kardex':     this.irAKardex(producto); break;
      case 'editar':     this.irAEditar(producto); break;
      case 'desactivar': await this.desactivarProducto(producto); break;
    }
  }

  private async desactivarProducto(producto: Producto) {
    const alert = await this.alertCtrl.create({
      header: `¿Quitar "${producto.nombre}"?`,
      message: 'Dejará de aparecer en el inventario y el POS. Puedes reactivarlo cuando quieras.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Quitar',
          role: 'destructive',
          handler: async () => {
            await this.inventarioService.desactivarProducto(producto.id);
            this.items = this.items.filter(p => p.id !== producto.id);
          }
        }
      ]
    });
    await alert.present();
  }

  // ==========================
  // SELECTOR DE CATEGORÍA (chips scrollables)
  // ==========================

  seleccionarCategoria(value: string, event: MouseEvent) {
    this.onFiltroChange(value);
    this.centrarChip(event.currentTarget as HTMLElement);
  }

  private centrarChip(chip: HTMLElement) {
    const container = this.categoriaScrollRef?.nativeElement;
    if (!container) return;
    const chipLeft = chip.offsetLeft;
    const chipWidth = chip.offsetWidth;
    const containerWidth = container.offsetWidth;
    const scrollTarget = chipLeft - containerWidth / 2 + chipWidth / 2;
    container.scrollTo({ left: scrollTarget, behavior: 'smooth' });
  }

  // ==========================
  // PRODUCTOS DESACTIVADOS
  // ==========================

  async reactivarProducto(producto: Producto) {
    const alert = await this.alertCtrl.create({
      header: 'Reactivar producto',
      message: `¿Reactivar "${producto.nombre}" al inventario activo?`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Reactivar',
          handler: async () => {
            await this.inventarioService.reactivarProducto(producto.id);
            this.items = this.items.filter(p => p.id !== producto.id);
          }
        }
      ]
    });
    await alert.present();
  }

  // ==========================
  // ESCÁNER → CREAR PRODUCTO
  // ==========================

  /** ¿Hay un overlay de Ionic abierto? (modal, alert, action-sheet, loading, popover)
   *  Chequeo síncrono del DOM — un overlay presente NO tiene `.overlay-hidden`. Evita que
   *  la pistola dispare el flujo por detrás mientras un alert/modal está abierto. */
  private hayOverlayAbierto(): boolean {
    return !!document.querySelector(
      'ion-modal:not(.overlay-hidden), ion-alert:not(.overlay-hidden), ' +
      'ion-action-sheet:not(.overlay-hidden), ion-loading:not(.overlay-hidden), ' +
      'ion-popover:not(.overlay-hidden)'
    );
  }

  // Pistola lectora física (HID): captura el escaneo cuando NINGÚN input tiene el foco y
  // dispara el MISMO flujo que la cámara (procesarCodigoEscaneado). keydown, no keypress
  // (deprecado). Con el input de búsqueda enfocado, el input maneja el escaneo por su cuenta.
  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    // Página cacheada pero no visible (el usuario está en otra ruta) → no procesar.
    if (!this.paginaActiva) return;

    // Overlay abierto (alert "producto encontrado", modal de ajuste, etc.) → no procesar.
    if (this.hayOverlayAbierto()) { this.barcodeBuffer = ''; return; }

    // Foco en un input (ej. el buscador) → ese input maneja el escaneo (onSearchKeyup).
    const target = event.target as HTMLElement;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'ION-INPUT' ||
        tag === 'ION-SEARCHBAR' || target.isContentEditable) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      if (this.barcodeBuffer.length > 3) {
        void this.procesarEscaneoFisico(this.barcodeBuffer);
      }
      this.barcodeBuffer = '';
    } else if (event.key.length === 1) { // dígitos/letras; descarta Shift, Tab, F1…
      this.barcodeBuffer += event.key;
      clearTimeout(this.barcodeTimeout);
      // Pistolas HID escriben ~5-20ms por tecla. 100ms resetea si fue tipeo humano lento.
      this.barcodeTimeout = setTimeout(() => { this.barcodeBuffer = ''; }, 100);
    }
  }

  /** Procesa un escaneo de pistola física con guard de reentrada (evita alerts/navegaciones
   *  duplicadas si llegan dos Enter seguidos). Reutiliza el flujo de la cámara. */
  private async procesarEscaneoFisico(codigo: string) {
    if (this.procesandoEscaneoFisico) return;
    this.procesandoEscaneoFisico = true;
    try {
      await this.procesarCodigoEscaneado(codigo);
    } finally {
      this.procesandoEscaneoFisico = false;
    }
  }

  async escanearYCrear() {
    this.escaneando = true;
    const codigo = await this.barcodeScanner.scan();
    this.escaneando = false;
    if (!codigo) return;
    await this.procesarCodigoEscaneado(codigo);
  }

  private async procesarCodigoEscaneado(codigo: string) {
    const productoExistente = await this.inventarioService.obtenerProductoPorCodigo(codigo);

    if (!productoExistente) {
      this.irACrearConCodigo(codigo);
      return;
    }

    const alert = await this.alertCtrl.create({
      header: 'Producto encontrado',
      message: `"${productoExistente.nombre}" ya tiene este código de barras.`,
      buttons: [
        {
          text: 'Editar producto',
          handler: () => this.irAEditar(productoExistente)
        },
        {
          text: 'Ver kardex',
          handler: () => this.navCtrl.navigateForward(ROUTES.inventario.kardex(productoExistente.id))
        },
        { text: 'Cancelar', role: 'cancel' }
      ]
    });
    await alert.present();
  }

  async cerrarEscaner() {
    await this.barcodeScanner.stop();
    this.escaneando = false;
  }

  // La página se cachea (IonicRouteStrategy): activar/desactivar el listener de pistola
  // según visibilidad, para no capturar escaneos destinados a otra página.
  ionViewWillEnter() {
    this.paginaActiva = true;
    this.procesandoEscaneoFisico = false; // reset por si quedó colgado tras navegar a crear/editar
  }

  ionViewDidLeave() {
    this.paginaActiva = false;
    this.barcodeBuffer = '';
    clearTimeout(this.barcodeTimeout);
  }

  ngOnDestroy() {
    if (this.escaneando) this.cerrarEscaner();
    clearTimeout(this.searchDebounce);
    clearTimeout(this.barcodeTimeout);
    this.productoChangeSub?.unsubscribe();
  }
}
