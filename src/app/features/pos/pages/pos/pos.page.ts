import { Component, OnInit, OnDestroy, inject, HostListener, ViewChild, ElementRef, signal, computed, Signal, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonTitle, IonToolbar,
  IonButtons, IonMenuButton, IonButton, IonIcon,
  IonFooter, IonList, IonItem, IonBadge, IonSpinner, IonSkeletonText,
  IonItemSliding, IonItemOptions, IonItemOption,
  IonRefresher, IonRefresherContent, IonFab, IonFabButton,
  AlertController, ModalController, ViewDidLeave, ViewWillEnter
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { BarcodeScannerService, AreaDeteccion } from '../../../../core/services/barcode-scanner.service';
import { barcodeOutline, cartOutline, cashOutline, addOutline, removeOutline, trashOutline, cubeOutline, searchOutline, personOutline, chevronForwardOutline, chevronBackOutline, refreshOutline, alertCircleOutline, closeOutline, pricetagOutline, arrowUpOutline, star, colorPaletteOutline, checkmarkCircle, createOutline } from 'ionicons/icons';
import { CategoriaProducto } from '../../../inventario/models/categoria-producto.model';
import { TipoComprobante } from '../../models/tipo-comprobante.enum';
import { OptionsMenuComponent, MenuOption } from '../../../../shared/components/options-menu/options-menu.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { InventarioService } from '../../../inventario/services/inventario.service';
import { ProductoService } from '../../../inventario/services/producto.service';
import { ProductoPOS, ProductoPresentacion } from '../../../inventario/models/producto.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { FeedbackOverlayService } from '../../../../core/services/feedback-overlay.service';
import { PosService, VentaPayload } from '../../services/pos.service';
import { CartItem, CatalogoItem } from '../../models/cart-item.model';
import { volarCloneHacia } from '../../utils/fly-clone.util';
import { crearScrollToTop } from '../../../../shared/utils/scroll-to-top.util';
import { ClientesService } from '../../../clientes/services/clientes.service';
import { Cliente } from '../../../clientes/models/cliente.model';
import { SeleccionarClienteModalComponent } from '../../../clientes/components/seleccionar-cliente-modal/seleccionar-cliente-modal.component';
import { CobrarModalComponent } from '../../components/cobrar-modal/cobrar-modal.component';
import { CantidadModalComponent, CantidadModalResult } from '../../components/cantidad-modal/cantidad-modal.component';
import { VarianteSelectorModalComponent, VarianteSelectorResult } from '../../components/variante-selector-modal/variante-selector-modal.component';
import { NetworkService } from '../../../../core/services/network.service';
import { CatalogoLocalService } from '../../../../core/services/catalogo-local.service';
import { SyncService } from '../../../../core/services/sync.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { StorageService } from '../../../../core/services/storage.service';
import { ConfigService } from '../../../../core/services/config.service';
import { Configuracion } from '../../../configuracion/models/configuracion.model';
import { ROUTES } from '../../../../core/config/routes.config';
import { ScannerOverlayComponent } from '../../../../shared/components/scanner-overlay/scanner-overlay.component';

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
    IonRefresher, IonRefresherContent, IonFab, IonFabButton,
    CommonModule, FormsModule,
    OptionsMenuComponent, EmptyStateComponent, ScannerOverlayComponent
  ]
})
export class PosPage implements OnInit, OnDestroy, ViewDidLeave, ViewWillEnter {
  @ViewChild(IonContent) content!: IonContent;
  @ViewChild('panelItems') panelItemsRef!: ElementRef<HTMLElement>;

  private inventarioService = inject(InventarioService);
  private productoService = inject(ProductoService);
  protected currencyService = inject(CurrencyService);
  private ui = inject(UiService);
  private feedback = inject(FeedbackOverlayService);
  private posService = inject(PosService);
  private alertCtrl = inject(AlertController);
  private modalCtrl = inject(ModalController);
  private clientesService = inject(ClientesService);
  protected barcodeScanner = inject(BarcodeScannerService);
  private network = inject(NetworkService);
  private catalogoLocal = inject(CatalogoLocalService);
  private syncService = inject(SyncService);
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
  buscando = false;
  modoBusqueda: 'codigo' | 'nombre' = 'nombre';
  private searchVersion = 0;
  escaneando = false;
  cobroEnProceso = false;
  // itemKey: identifica el CartItem exacto del producto escaneado, para poder abrir su
  // modal de cantidad si el usuario toca el banner para corregir (ej. escaneó de más).
  scanPreview: { itemKey: string; nombre: string; cantidad: number; subtotal: number; precioUnitario: number } | null = null;
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
  /** Sentinel del tab "Favoritos" — nunca es un UUID real, nunca baja a fn_catalogo_productos_pos ni al cache offline. */
  readonly FAVORITOS_ID = '__favoritos__';
  readonly productosCatalogo = signal<ProductoPOS[]>([]);
  cargandoCatalogo = false;
  catalogoSearchAbierto = false;

  /** Controller de scroll-to-top del catálogo (showScrollTop, onContentScroll, scrollToTop) —
   *  compartido con PaginatedListPage y otras páginas (ver shared/utils/scroll-to-top.util.ts). */
  readonly scrollTop = crearScrollToTop(() => this.content);
  /** Snapshot completo del catálogo (todas las categorías) — filtro por categoría sin roundtrip. */
  private catalogoCompleto: ProductoPOS[] | null = null;
  /** Descarta resoluciones de imágenes en background que quedaron obsoletas (carrera filtro vs resolución). */
  private catalogoVersion = 0;

  // IDs de productos con animación activa en el catálogo
  catalogoCardAnimando: string | null = null;
  totalAmountAnimando = false;

  /**
   * Scroll del panel desktop al agregar/incrementar un ítem.
   *  - esNuevo=true (línea nueva): scroll al FONDO para mostrar el último ítem completo.
   *    El bug anterior usaba scrollIntoView(block:'nearest'), que hace el MÍNIMO scroll y
   *    dejaba el último ítem a medias. scrollTo(scrollHeight) baja del todo. (El scale de
   *    cartItemEnter es un transform → no altera scrollHeight, así que no hace falta esperar
   *    a que termine la animación; solo un tick para que el nodo ya esté en el DOM.)
   *  - esNuevo=false (incremento de un ítem existente, que puede estar arriba): scroll al
   *    ítem que cambió (block:'nearest'), sin arrastrar al usuario hasta el fondo.
   */
  private dispararAnimacionPanel(itemKey: string, esNuevo = false) {
    if (!this.esDesktop) return;
    setTimeout(() => {
      const panel = this.panelItemsRef?.nativeElement;
      if (!panel) return;
      if (esNuevo) {
        panel.scrollTo({ top: panel.scrollHeight, behavior: 'smooth' });
      } else {
        const itemEl = panel.querySelector<HTMLElement>(`[data-item-key="${CSS.escape(itemKey)}"]`);
        itemEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 40);
  }

  private catalogoAnimTimeout: ReturnType<typeof setTimeout> | undefined;
  private dispararAnimacionCatalogo(productoId: string) {
    // Solo la animación de la card. El total lo anima actualizarCantidad/agregarLineaNueva
    // (único punto centralizado) — así mouse, pistola y botones +/- se comportan igual.
    // Robusto ante taps rápidos del MISMO producto: apagar → macrotask → reencender reinicia
    // el keyframe (si no, Angular no re-aplica la clase al no cambiar el valor); y el timer
    // guardado evita que un timeout viejo corte la animación del tap nuevo a la mitad.
    clearTimeout(this.catalogoAnimTimeout);
    this.catalogoCardAnimando = null;
    this.cdr.markForCheck();
    setTimeout(() => {
      this.catalogoCardAnimando = productoId;
      this.cdr.markForCheck();
      this.catalogoAnimTimeout = setTimeout(() => {
        this.catalogoCardAnimando = null;
        this.cdr.markForCheck();
      }, 400);
    }, 0);
  }

  /** Anima el total a pagar (panel desktop, footer mobile y pill del catálogo).
   *  Único punto de disparo — se llama en TODA ruta que muta la cantidad del carrito
   *  (mouse, pistola, listener global o botones +/-) para que el feedback sea idéntico
   *  en web y APK. En escaneos rápidos consecutivos apaga y reenciende la clase para
   *  reiniciar el keyframe (sin acumular timers). */
  private animarTotal() {
    clearTimeout(this.totalAnimTimeout);
    // Apagar primero: si ya estaba animando, Angular quita la clase y el macrotask de
    // abajo la repone → el navegador reinicia la animación desde el frame 0.
    this.totalAmountAnimando = false;
    this.cdr.markForCheck();
    setTimeout(() => {
      this.totalAmountAnimando = true;
      this.cdr.markForCheck();
      this.totalAnimTimeout = setTimeout(() => {
        this.totalAmountAnimando = false;
        this.cdr.markForCheck();
      }, 500);
    }, 0);
  }
  private totalAnimTimeout: ReturnType<typeof setTimeout> | undefined;

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
    this.scrollTop.reset();
    this.limpiarBusqueda();
  }

  /** Desde lista → volver al catálogo (botón atrás en modo lista cuando vino del catálogo) */
  volverAlCatalogo() {
    // El feedback del botón (:active — flecha deslizándose) ocurre DURANTE el press,
    // antes de soltar, así que no hace falta demorar el cambio de vista. El catálogo
    // aparece con su .tab-animate (fade + subida). Transición sin demora perceptible.
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
      await this.cargarCatalogoDesdeServidor();
    } finally {
      this.cargandoCatalogo = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Núcleo compartido de carga del catálogo (lo usan cargarCatalogo y refrescarCatalogo):
   * trae SIEMPRE el snapshot completo (refresca también el cache offline — un fetch
   * filtrado no lo escribe), lo guarda en memoria para el filtro por categoría sin red,
   * publica la vista filtrada y sincroniza el stock del carrito.
   */
  private async cargarCatalogoDesdeServidor(): Promise<void> {
    const categorias = await this.inventarioService.obtenerCategorias();
    if (categorias.length > 0) this.categoriasCatalogo = categorias;
    // Pasar las categorías ya cargadas evita una query extra al guardar el cache.
    const productos = await this.inventarioService.obtenerProductosCatalogoPOS(undefined, categorias);
    // Respuesta vacía con catálogo ya pintado = casi seguro un fallo de red enmascarado
    // (supabase.call retorna null → []). No pisar el catálogo visible con un grid vacío.
    if (productos.length === 0 && (this.catalogoCompleto?.length ?? 0) > 0) return;
    this.catalogoCompleto = productos;
    this.publicarCatalogoConImagenesProgresivas(this.filtrarPorCategoria(productos));
    this.sincronizarStockCarrito(productos);

    // Descargar a disco los binarios de TODAS las imágenes del catálogo (no solo las
    // que llegan a renderizarse) — un producto recién creado en Inventario quedaba en
    // el cache SQLite pero sin binario si su card no se pintó, y en el próximo arranque
    // offline aparecía sin foto. Best-effort, en tandas, no-op offline/web y casi
    // gratis cuando no hay imágenes nuevas (solo compara contra el índice en disco).
    void this.syncService.precalentarImagenes(productos);
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
    this.catalogoCompleto = cacheados;
    this.publicarCatalogoConImagenesProgresivas(cacheados);
    return true;
  }

  private filtrarPorCategoria(productos: ProductoPOS[]): ProductoPOS[] {
    if (this.categoriaActivaId === this.FAVORITOS_ID) {
      return productos.filter(p => p.favorito);
    }
    return this.categoriaActivaId
      ? productos.filter(p => p.categoria_id === this.categoriaActivaId)
      : productos;
  }

  async seleccionarCategoriaCatalogo(categoriaId: string | null) {
    if (this.categoriaActivaId === categoriaId) return;
    this.categoriaActivaId  = categoriaId;
    this.scrollTop.reset();
    this.content?.scrollToTop(0);
    this.cdr.markForCheck();

    // Scroll automático al tab activo dentro de la barra horizontal
    setTimeout(() => {
      const attrValue = categoriaId ?? '__todos__';
      const tabEl = document.querySelector<HTMLElement>(`.catalogo-cats-bar [data-cat-id="${attrValue}"]`);
      tabEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 0);

    // Con el snapshot completo en memoria el filtro es puro JS — instantáneo, sin
    // roundtrip ni spinner. La frescura del stock la garantizan el enter a la página,
    // el pull-to-refresh y el descuento local tras cada venta.
    if (this.catalogoCompleto) {
      this.publicarCatalogoConImagenesProgresivas(this.filtrarPorCategoria(this.catalogoCompleto));
      return;
    }

    // Sin snapshot aún (primera carga en vuelo): fetch puntual con spinner.
    // ⚠️ El sentinel de favoritos NUNCA baja al RPC (p_categoria_id es UUID) ni al
    // cache offline (categoria_id no calza) — se pide el catálogo completo y se
    // filtra en memoria, igual que el resto de los casos con snapshot.
    this.cargandoCatalogo = true;
    this.cdr.markForCheck();
    try {
      const esFavoritos = categoriaId === this.FAVORITOS_ID;
      const productos = await this.inventarioService.obtenerProductosCatalogoPOS(
        esFavoritos ? undefined : categoriaId ?? undefined
      );
      this.publicarCatalogoConImagenesProgresivas(this.filtrarPorCategoria(productos));
    } finally {
      this.cargandoCatalogo = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * True si el valor ya es una URL que el <img> puede renderizar directamente (no un path
   * crudo de Storage que haya que firmar). Mismo criterio que StorageService.resolveImageUrl.
   */
  private esUrlRenderizable(valor: string | null | undefined): boolean {
    return !!valor && /^(https?:|blob:|data:|capacitor:)/.test(valor);
  }

  /**
   * Publica el catálogo en dos pasos para que la cuadrícula aparezca al instante:
   *  Paso 1 (síncrono): pinta los productos reutilizando las imágenes ya resueltas en
   *    el catálogo actual (mismo producto/template) → 0 llamadas a Storage, render inmediato.
   *  Paso 2 (background): resuelve las URLs nuevas en tandas sin bloquear la UI y
   *    re-publica progresivamente. Un contador de versión descarta resoluciones que
   *    llegan tarde (p.ej. el usuario cambió de categoría con la anterior aún resolviendo).
   * Único punto de pintado del catálogo — lo usan cargarCatalogo, filtro y refresco.
   */
  private publicarCatalogoConImagenesProgresivas(productos: ProductoPOS[]) {
    const version = ++this.catalogoVersion;
    const catalogoActual = this.productosCatalogo();
    const imagenesCacheadas = new Map(catalogoActual.map(p => [p.id, p.imagen_url]));
    const templateImagenesCacheadas = new Map(
      catalogoActual
        .filter(p => p.producto_template_id && this.esUrlRenderizable(p.producto_template?.imagen_url))
        .map(p => [p.producto_template_id!, p.producto_template!.imagen_url!])
    );

    // Paso 1: pintar ya, con las imágenes que tengamos a mano.
    // Solo se usa una URL ya renderizable (firmada http, blob local, data). Si solo hay
    // path crudo de Storage, se deja undefined (placeholder) — pintarlo haría que <img>
    // pida el path como ruta local (localhost/{path}) → 404 en consola. El Paso 2 lo firma
    // y re-publica. Reconocer blob:/data: evita descartar imágenes locales ya resueltas y
    // re-resolverlas en cada re-publish (parpadeo + trabajo redundante).
    const urlFirmada = (valor: string | null | undefined): string | undefined =>
      this.esUrlRenderizable(valor) ? valor! : undefined;

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
    void this.resolverImagenesEnTandas(productos, productosConImagenCacheada, version);
  }

  /**
   * Resuelve las imágenes del catálogo en tandas acotadas (evita cientos de requests
   * concurrentes en la primera carga online) y re-publica progresivamente: las fotos
   * van apareciendo por bloques en vez de todas al final.
   */
  private async resolverImagenesEnTandas(productos: ProductoPOS[], base: ProductoPOS[], version: number): Promise<void> {
    const LOTE = 24;
    const resultado = [...base];
    for (let i = 0; i < productos.length; i += LOTE) {
      const tanda = productos.slice(i, i + LOTE);
      try {
        const resueltos = await Promise.all(tanda.map(p => this.resolverImagen(p)));
        if (version !== this.catalogoVersion) return; // llegó tarde — ya se publicó otro catálogo
        for (let j = 0; j < resueltos.length; j++) resultado[i + j] = resueltos[j];
        this.productosCatalogo.set([...resultado]);
        this.cdr.markForCheck();
      } catch { /* una tanda fallida no rompe el resto */ }
    }
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

  async agregarDesdeCatalogo(producto: ProductoPOS, event?: MouseEvent | TouchEvent | PointerEvent) {
    // Capturar card y rect ANTES del await — tras el re-render el card puede reordenarse.
    // Con pointer capture activo, currentTarget/target apuntan al botón capturador; buscamos
    // la .catalogo-card más cercana (que es el propio botón) para clonar la card correcta.
    const cardEl = event
      ? ((event.currentTarget ?? event.target) as HTMLElement).closest('.catalogo-card') as HTMLElement | null
      : null;
    // Volar SOLO la zona de imagen (.catalogo-card-img), no la card completa: la foto (o el
    // placeholder de color con el nombre si no hay foto) representa el producto y se ve limpia
    // al encogerse. Una card entera con texto a 32px se vería apretujada.
    const imgEl = cardEl?.querySelector<HTMLElement>('.catalogo-card-img') ?? null;
    const cardRect  = imgEl?.getBoundingClientRect() ?? null;
    const cardClone = imgEl?.cloneNode(true) as HTMLElement | null ?? null;
    // Quitar del clon los badges/tags superpuestos (peso, presentaciones) — solo debe volar
    // la imagen/placeholder puro, sin adornos.
    cardClone?.querySelectorAll('.catalogo-card-multi, .catalogo-card-tag').forEach(el => el.remove());

    const tienePresentaciones = (producto.presentaciones?.length ?? 0) > 0;
    const totalAntes = this.totalArticulos();
    await this.seleccionarProductoBusqueda(producto, false);
    const seAgrego = this.totalArticulos() > totalAntes;

    // Solo animar en productos simples sin presentaciones — en presentaciones/variantes
    // el flujo pasa por un modal y la animación se siente desfasada.
    // El scroll del panel NO se dispara aquí: agregarAlCarrito (dentro de
    // seleccionarProductoBusqueda) ya lo hizo con el esNuevo correcto — llamarlo de nuevo
    // duplicaba el scroll con timings distintos que se peleaban.
    if (seAgrego && !tienePresentaciones) {
      // La vibración ya la disparó agregarLineaNueva (o la rama de incremento) dentro de
      // seleccionarProductoBusqueda → aquí solo la animación de la card, sin duplicar.
      this.dispararAnimacionCatalogo(producto.id);
      if (cardRect && cardClone) setTimeout(() => this.flyToPillFromClone(cardClone, cardRect), 0);
    }
  }

  // ==========================================
  // GESTOS DE LA CARD DEL CATÁLOGO
  //   • Tap / press corto → agregar al carrito (acción principal, instantánea al soltar)
  //   • Long-press (≥450ms) → marcar/desmarcar favorito (solo productos SIN presentaciones)
  //
  // Diseño robusto contra taps rápidos: el estado del gesto está atado a UN pointerId a la
  // vez, no hay evento (click) sintético en el flujo, y el ÚNICO timer (el del favorito) se
  // cancela en todas las salidas (up/cancel/nuevo down). Así se eliminó el bug de timers
  // huérfanos que disparaban favoritos fantasma y taps que se cruzaban entre cards.
  //
  // Scroll: touch-action: pan-y (SCSS) delega el scroll vertical al navegador, que al
  // tomar el gesto emite pointercancel y limpia el gesto automáticamente. No escuchamos
  // pointermove a propósito — dispararía change detection (OnPush) en cada píxel de
  // movimiento sobre una grilla grande, sin aportar sobre lo que ya cubre pointercancel.
  //
  // El pointerup decide: si el favorito ya se disparó → no agrega; si no → agrega.
  // ==========================================
  private gesto: {
    pointerId: number;
    producto: ProductoPOS;
    favoritoDisparado: boolean;
    hapticTimer: ReturnType<typeof setTimeout> | null;
  } | null = null;
  private readonly LONG_PRESS_MS = 450;

  onCardPointerDown(producto: ProductoPOS, event: PointerEvent) {
    // Solo el botón primario / touch / lápiz. Ignorar clic derecho o punteros extra.
    if (event.button !== 0) return;
    // Si ya hay un gesto en curso (multitouch), lo descartamos: un solo gesto a la vez.
    this.cancelarGesto();

    // NOTA: no usamos setPointerCapture — en touch la captura es implícita (pointerup
    // llega al mismo elemento) y capturar explícitamente puede interferir con el scroll
    // del ion-content en algunos WebViews.
    this.gesto = {
      pointerId: event.pointerId,
      producto,
      favoritoDisparado: false,
      hapticTimer: null,
    };

    // Favorito solo aplica a productos simples sin presentaciones (los que tienen
    // presentaciones abren un modal al soltar). El timer da el feedback háptico + toggle
    // en el instante que se cumple el umbral, sin esperar al pointerup.
    if ((producto.presentaciones?.length ?? 0) === 0) {
      this.gesto.hapticTimer = setTimeout(() => {
        if (!this.gesto || this.gesto.pointerId !== event.pointerId) return;
        this.gesto.favoritoDisparado = true;
        this.gesto.hapticTimer = null;
        navigator.vibrate?.(15);
        this.toggleFavoritoCatalogo(producto);
      }, this.LONG_PRESS_MS);
    }
  }

  onCardPointerUp(event: PointerEvent) {
    const g = this.gesto;
    if (!g || g.pointerId !== event.pointerId) return;

    const favoritoYaMarcado = g.favoritoDisparado;
    const producto = g.producto;
    this.cancelarGesto();

    // Si el long-press ya marcó el favorito, este pointerup solo cierra el gesto — no
    // agrega al carrito (sería una acción doble que el usuario no pidió).
    // En cualquier otro caso (tap corto, o press largo sobre un producto que no puede ser
    // favorito como los que tienen presentaciones) el pointerup agrega / abre el modal.
    if (!favoritoYaMarcado) {
      this.agregarDesdeCatalogo(producto, event);
    }
  }

  onCardPointerCancel(event: PointerEvent) {
    if (this.gesto && this.gesto.pointerId === event.pointerId) this.cancelarGesto();
  }

  private cancelarGesto() {
    if (this.gesto?.hapticTimer) clearTimeout(this.gesto.hapticTimer);
    this.gesto = null;
  }

  /**
   * Toggle optimista sobre el snapshot en memoria (catalogoCompleto + productosCatalogo)
   * — igual que el toggle de Inventario: sin loading ni toast (el ícono es el feedback).
   * Si el tab activo es Favoritos, al desmarcar el producto desaparece de la vista
   * porque filtrarPorCategoria() ya no lo incluye.
   */
  private async toggleFavoritoCatalogo(producto: ProductoPOS) {
    const nuevo = !producto.favorito;
    this.mutarFavoritoEnMemoria(producto.id, nuevo);
    const updated = await this.productoService.toggleFavorito(producto.id, nuevo);
    if (!updated) this.mutarFavoritoEnMemoria(producto.id, !nuevo);
  }

  /**
   * Muta solo el flag `favorito` en el snapshot y en la vista. Un toggle de favorito NO
   * cambia ninguna imagen, así que trabajamos sobre `productosCatalogo()` (que YA tiene
   * las URLs firmadas resueltas) en vez de re-publicar desde `catalogoCompleto` (paths
   * crudos de Storage → miniaturas rotas) ni re-disparar el pipeline de resolución de
   * imágenes en tandas (innecesario). Bug de imágenes corruptas resuelto así (2026-07-16).
   *
   * En el tab Favoritos, desmarcar quita el producto de la vista (filtrarPorCategoria);
   * por eso re-derivamos la lista visible desde el snapshot ya resuelto en memoria.
   */
  private mutarFavoritoEnMemoria(productoId: string, favorito: boolean) {
    this.mutarFavoritoGrupoEnMemoria([productoId], favorito);
  }

  /** Igual que mutarFavoritoEnMemoria pero para un CONJUNTO de productos (todas las
   *  variantes de un template, o un producto con presentaciones). Conserva imágenes
   *  firmadas en ambos niveles (producto + template) para no romper miniaturas. */
  private mutarFavoritoGrupoEnMemoria(productoIds: string[], favorito: boolean) {
    const ids = new Set(productoIds);
    // Snapshot crudo (para filtros y próximas cargas) — se muta por identidad.
    if (this.catalogoCompleto) {
      this.catalogoCompleto = this.catalogoCompleto.map(p =>
        ids.has(p.id) ? { ...p, favorito } : p
      );
    }

    // Índices de imágenes YA firmadas (http) tomados de la vista actual — así el re-render
    // conserva las miniaturas sin volver a firmar nada. Se conservan DOS niveles:
    //  • imagen_url del producto (cards simples y con presentaciones).
    //  • producto_template.imagen_url (cards de VARIANTES — su miniatura sale del template).
    // Sin conservar el template, las cards de variantes quedaban con el path crudo de
    // catalogoCompleto → 404 al marcar favorito (bug 2026-07-21).
    const vistaActualCat = this.productosCatalogo();
    const imagenesFirmadas = new Map(vistaActualCat.map(p => [p.id, p.imagen_url]));
    const templateImagenesFirmadas = new Map(
      vistaActualCat
        .filter(p => p.producto_template_id && this.esUrlRenderizable(p.producto_template?.imagen_url))
        .map(p => [p.producto_template_id!, p.producto_template!.imagen_url!])
    );

    const base = this.catalogoCompleto ?? vistaActualCat;
    const visibles = this.filtrarPorCategoria(base).map(p => {
      const result = {
        ...p,
        favorito: ids.has(p.id) ? favorito : p.favorito,
        imagen_url: imagenesFirmadas.get(p.id) ?? p.imagen_url,
      };
      // Conservar la imagen firmada del template (si la card es de variantes)
      if (result.producto_template) {
        const tplFirmada = templateImagenesFirmadas.get(p.producto_template_id!);
        result.producto_template = {
          ...result.producto_template,
          imagen_url: tplFirmada ?? result.producto_template.imagen_url,
        };
      }
      return result;
    });
    this.productosCatalogo.set(visibles);
    this.cdr.markForCheck();
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

    volarCloneHacia(cardClone, cardRect, pillEl, {
      tamanoFinal: 32,
      borderRadius: 'var(--radius-md)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
      escalaInicial: 0.6, // parte al 60% de la imagen → vuelo más ligero, menos saturado
    });
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
  /** True mientras se procesa un agregado originado por escaneo físico (pistola HID o
   *  input en modo código). Habilita el preview efímero del producto en el catálogo sin
   *  el beep de la app (la pistola ya beepea por hardware). El click de mouse no lo activa. */
  private origenEscaneoFisico = false;

  // Anti-duplicados para escáner de cámara
  private ultimoCodigoEscaneado = '';
  private ultimoTiempoEscaneado = 0;
  private procesandoEscaneo = false;

  // Configuración de descuentos (cargada una vez al init)
  private appConfig: Configuracion | null = null;

  // Control de página activa (Ionic cachea páginas)
  private paginaActiva = true;

  // ngOnInit ya carga todo en la primera entrada — ionViewWillEnter no debe duplicarlo
  private primeraActivacion = true;

  constructor() {
    addIcons({
      barcodeOutline, cartOutline, cashOutline,
      addOutline, removeOutline, trashOutline,
      cubeOutline, searchOutline, personOutline,
      chevronForwardOutline, chevronBackOutline, refreshOutline,
      alertCircleOutline, closeOutline, pricetagOutline,
      arrowUpOutline, star, colorPaletteOutline, checkmarkCircle, createOutline
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

  /**
   * Tono de placeholder cuando el producto no tiene foto — hash determinista del
   * nombre sobre 5 tonos (.ph-color-N en .catalogo-card-placeholder-nombre del SCSS,
   * todos con contraste AA contra el texto blanco). El mismo producto siempre cae en
   * el mismo tono entre recargas (no es aleatorio): el hash usa el NOMBRE y no el id
   * a propósito — el color acompaña a la etiqueta que el cajero lee, y productos
   * renombrados cambian de tono junto con su texto.
   */
  colorPlaceholder(nombre: string): string {
    let hash = 0;
    for (let i = 0; i < nombre.length; i++) {
      hash = (hash * 31 + nombre.charCodeAt(i)) | 0;
    }
    return `ph-color-${Math.abs(hash) % 5}`;
  }

  readonly carritoCountMap = computed(() =>
    this.carrito().reduce((map, item) => {
      map[item.id] = (map[item.id] || 0) + item.cantidad;
      return map;
    }, {} as Record<string, number>)
  );

  /** Unidades BASE comprometidas por producto (cantidad × factor_conversion) — para calcular
   *  stock libre real en badges. carritoCountMap suma cantidades "como las cuenta el usuario"
   *  (2 cajetillas = 2), este map las convierte a unidades de inventario (2 × 10 = 20). */
  readonly carritoUnidadesBaseMap = computed(() =>
    this.carrito().reduce((map, item) => {
      map[item.id] = (map[item.id] || 0) + item.cantidad * (item.factor_conversion ?? 1);
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

  /**
   * Desglose fiscal para un factor de descuento y total dados. Lo reutilizan los
   * computed de la UI (con descuento aplicado) y el cobro FIADO (factor 1 — el fiado
   * anula el descuento, sus bases fiscales deben calcularse sin él).
   */
  private calcularDesglose(factor: number, total: number) {
    const brutos = this._brutosDesglose();
    const base0  = Math.round(brutos.sinIva * factor * 100) / 100;
    const base15 = Math.round((brutos.conIva * factor / this._ivaDivisor()) * 100) / 100;
    return {
      base0, base15,
      iva:  Math.round((total - base0 - base15) * 100) / 100,
      neto: Math.round((base0 + base15) * 100) / 100,
    };
  }

  private readonly _desglose = computed(() => this.calcularDesglose(this._factorDescuento(), this.totalPagar()));
  readonly baseIva0     = computed(() => this._desglose().base0);
  readonly baseIva15    = computed(() => this._desglose().base15);
  readonly ivaValor     = computed(() => this._desglose().iva);
  readonly subtotalNeto = computed(() => this._desglose().neto);

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

  // ── Helpers del carrito ─────────────────────────────────────────────
  // Toda mutación del carrito se hace por CLAVE compuesta (id + presentacion_id), la
  // misma que usa el track del template. Nunca por identidad de objeto: los refrescos
  // de stock reemplazan los objetos del array y una referencia capturada antes de un
  // await queda huérfana — mutar por identidad fallaba silenciosamente en ese caso.

  /** Clave única de una línea del carrito. */
  private keyDe(item: CartItem): string {
    return item.id + (item.presentacion_id ?? '');
  }

  /** Línea del carrito que coincide con un producto+presentación, o undefined. Único punto
   *  para este lookup (antes duplicado en agregarAlCarrito y agregarAlCarritoConCantidad). */
  private buscarLineaEnCarrito(producto: ProductoPOS, presentacion?: ProductoPresentacion): CartItem | undefined {
    return this.carrito().find(item =>
      item.id === producto.id &&
      item.presentacion_id === (presentacion?.id ?? undefined)
    );
  }

  private calcularSubtotal(cantidad: number, precioUnitario: number): number {
    return Math.round(cantidad * precioUnitario * 100) / 100;
  }

  /** Actualiza cantidad y subtotal de una línea por su clave.
   *  Toda mutación de cantidad pasa por aquí → único punto que anima el total,
   *  garantizando feedback idéntico en mouse, pistola y botones +/- (web y APK). */
  private actualizarCantidad(key: string, cantidad: number) {
    this.carrito.update(c => c.map(i => this.keyDe(i) === key
      ? { ...i, cantidad, subtotal: this.calcularSubtotal(cantidad, i.precio_venta) }
      : i
    ));
    this.animarTotal();
  }

  /** Marca la línea recién agregada para su animación de entrada. */
  private addedAnimTimeout: ReturnType<typeof setTimeout> | undefined;
  private marcarAgregado(key: string) {
    // Timer guardado: al agregar varias líneas nuevas seguidas (taps rápidos de productos
    // distintos), un timeout viejo no debe limpiar el lastAddedKey de la línea más reciente.
    clearTimeout(this.addedAnimTimeout);
    this.lastAddedKey = key;
    this.cdr.markForCheck();
    this.addedAnimTimeout = setTimeout(() => {
      this.lastAddedKey = null;
      this.cdr.markForCheck();
    }, 600);
  }

  /** Crea una línea nueva en el carrito y dispara el feedback estándar.
   *  La imagen se resuelve en BACKGROUND (no bloquea): agregar al carrito debe ser
   *  instantáneo. resolveImageUrl puede tardar si toca red (firmar signed URL de un
   *  producto aún no renderizado) — antes ese await hacía que "Agregar" se sintiera
   *  lento de forma intermitente. La miniatura se rellena cuando la imagen llega. */
  private async agregarLineaNueva(producto: ProductoPOS, cantidad: number, presentacion?: ProductoPresentacion) {
    const precioVenta = presentacion?.precio_venta ?? producto.precio_venta;
    // Imagen provisional: solo si YA es renderizable (firmada/blob/data). Un path crudo de
    // Storage se deja undefined (placeholder) — pintarlo haría que <img> pida localhost/{path}
    // → 404 en consola. El background (resolverImagenLinea) la firma y rellena.
    const imgProvisional = presentacion?.imagen_url || producto.imagen_url;
    const item: CartItem = {
      ...producto,
      imagen_url: this.esUrlRenderizable(imgProvisional) ? imgProvisional! : undefined,
      precio_venta: precioVenta,
      cantidad,
      subtotal: this.calcularSubtotal(cantidad, precioVenta),
      stock_disponible: producto.stock_actual,
      ...(presentacion ? {
        presentacion_id: presentacion.id,
        presentacion_nombre: presentacion.nombre,
        factor_conversion: presentacion.factor_conversion
      } : {})
    };
    this.carrito.update(c => [...c, item]);
    const key = this.keyDe(item);
    // Si la imagen provisional ya es renderizable, la línea ya tiene su miniatura correcta.
    // Si no, resolverla en background y rellenarla por su clave cuando llegue (no bloquea).
    if (!item.imagen_url) void this.resolverImagenLinea(key, producto, presentacion);
    this.vibrarAgregado(); // único punto de vibración para líneas nuevas (click catálogo + pistola)
    this.marcarAgregado(key);
    this.dispararAnimacionPanel(key, true); // línea nueva → scroll al fondo
    this.animarTotal();
    this.feedbackEscaneo(key);
    this.scrollToBottom();
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
    const stockUsado = this.stockUsadoPorProducto(producto.id);

    const existe = this.buscarLineaEnCarrito(producto, presentacion);

    if (existe) {
      const maxParaEste = Math.floor((stockBase - stockUsado + existe.cantidad * factor) / factor);
      if (existe.cantidad < maxParaEste) {
        this.vibrarAgregado();
        this.incrementar(existe);
        this.dispararAnimacionPanel(this.keyDe(existe));
        this.feedbackEscaneo(this.keyDe(existe));
        this.scrollToBottom();
        return true;
      }
      this.ui.showToast('Stock insuficiente', 'warning');
      return false;
    }

    if (Math.floor((stockBase - stockUsado) / factor) <= 0) {
      this.ui.showToast('Producto sin stock', 'danger');
      return false;
    }

    await this.agregarLineaNueva(producto, 1, presentacion);
    return true;
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

  /** Resuelve la imagen de una línea ya agregada y actualiza su miniatura por CLAVE
   *  (no por identidad — la línea puede haberse reemplazado por un refresco de stock).
   *  Corre en background desde agregarLineaNueva para no bloquear el "Agregar". */
  private async resolverImagenLinea(key: string, producto: ProductoPOS, presentacion?: ProductoPresentacion) {
    const skuPath = presentacion?.imagen_url || producto.imagen_url || producto.producto_template?.imagen_url;
    const url = await this.storageService.resolveImageUrl(skuPath);
    if (!url) return; // sin imagen resuelta → queda el placeholder
    this.carrito.update(c => c.map(i =>
      this.keyDe(i) === key ? { ...i, imagen_url: url } : i
    ));
    this.cdr.markForCheck();
  }

  /** Calcula cuantas unidades base de un producto estan comprometidas en el carrito */
  private stockUsadoPorProducto(productoId: string): number {
    return this.carrito()
        .filter(i => i.id === productoId)
        .reduce((sum, i) => sum + i.cantidad * (i.factor_conversion ?? 1), 0);
  }

  /** Modal para ingresar cantidad (granel) al agregar un producto por peso NUEVO.
   *  Si el producto ya está en el carrito, el flujo pasa por editarCantidad(). */
  private async pedirCantidadPeso(producto: ProductoPOS) {
    const disponible = producto.stock_actual;
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
        cantidadActual: 0,
        esEdicion: false,
        imagenUrl: producto.imagen_url
      },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });

    await modal.present();
    const { data, role } = await modal.onDidDismiss<CantidadModalResult>();
    if (role !== 'confirm' || !data) return;

    await this.agregarLineaNueva(producto, data.cantidad);
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

  /** Agrega N unidades de un producto al carrito (para patrón cantidad.codigo) */
  async agregarAlCarritoConCantidad(producto: ProductoPOS, cantidad: number, presentacion?: ProductoPresentacion) {
    const stockBase = producto.stock_actual;
    const factor = presentacion?.factor_conversion ?? 1;
    const stockUsado = this.stockUsadoPorProducto(producto.id);
    const stockLibre = stockBase - stockUsado;

    if (Math.floor(stockLibre / factor) <= 0) {
      this.ui.showToast('Producto sin stock', 'danger');
      return;
    }

    const existe = this.buscarLineaEnCarrito(producto, presentacion);

    const stockLibreConEste = existe ? stockLibre + (existe.cantidad * factor) : stockLibre;
    const maxParaEste = Math.floor(stockLibreConEste / factor);
    const yaEnCarrito = existe?.cantidad ?? 0;
    const cantidadReal = Math.min(cantidad, maxParaEste - yaEnCarrito);

    if (cantidadReal <= 0) {
      this.ui.showToast('Stock insuficiente', 'warning');
      return;
    }

    if (existe) {
      this.vibrarAgregado();
      this.actualizarCantidad(this.keyDe(existe), existe.cantidad + cantidadReal);
      this.triggerIncrementAnimation(existe);
      this.dispararAnimacionPanel(this.keyDe(existe));
      this.feedbackEscaneo(this.keyDe(existe));
      this.scrollToBottom();
    } else {
      await this.agregarLineaNueva(producto, cantidadReal, presentacion);
    }

    if (cantidadReal < cantidad) {
      this.ui.showToast(`Solo se agregaron ${cantidadReal} (stock máximo)`, 'warning');
    }
  }

  private incrementAnimTimeout: ReturnType<typeof setTimeout> | undefined;
  private triggerIncrementAnimation(item: CartItem) {
    // Robusto ante taps rápidos del MISMO ítem (incrementar varias veces seguidas): apagar
    // → macrotask → reencender reinicia el keyframe qtyBump desde el frame 0, y el timer
    // guardado evita que un timeout viejo corte el bump del tap nuevo.
    const key = this.keyDe(item);
    clearTimeout(this.incrementAnimTimeout);
    this.lastIncrementedKey = null;
    this.cdr.markForCheck();
    setTimeout(() => {
      this.lastIncrementedKey = key;
      this.cdr.markForCheck();
      this.incrementAnimTimeout = setTimeout(() => {
        this.lastIncrementedKey = null;
        this.cdr.markForCheck();
      }, 350);
    }, 0);
  }

  /** Preview efímero del producto escaneado (+ beep/vibración solo en modo cámara).
   *  Se muestra al escanear con la cámara fullscreen O con pistola física en el catálogo
   *  — NO al agregar con click de mouse (ahí la card ya se anima). Recibe la CLAVE de la
   *  línea (id + presentacion_id) para mostrar la línea correcta cuando el mismo producto
   *  tiene unidad suelta y presentaciones en el carrito. */
  /** Vibración táctil coherente al agregar/incrementar un producto en el carrito.
   *  Un solo valor (22ms) para todas las vías (click, pistola). NO vibra en modo cámara:
   *  ahí el scanner ya da su propio feedback (barcodeScanner.feedback → 40ms) y duplicar
   *  se sentiría doble. Único punto → mismo "peso" táctil en toda la app. */
  private vibrarAgregado() {
    if (this.escaneando) return; // el scanner de cámara ya vibró
    navigator.vibrate?.(22);
  }

  private feedbackEscaneo(itemKey: string) {
    // Solo hay preview si el agregado vino de un escaneo (cámara o pistola), no de mouse.
    if (!this.escaneando && !this.origenEscaneoFisico) return;

    // Beep/vibración de la app solo en modo cámara — la pistola física ya beepea por hardware.
    if (this.escaneando) this.barcodeScanner.feedback();

    // En desktop el preview del catálogo es redundante (el panel lateral ya muestra los
    // ítems en vivo). Sí se mantiene en modo cámara fullscreen (no hay panel a la vista).
    if (this.esDesktop && !this.escaneando) return;

    const item = this.carrito().find(i => this.keyDe(i) === itemKey);
    if (!item) return;
    clearTimeout(this.scanPreviewTimeout);
    this.scanPreview = { itemKey, nombre: item.nombre, cantidad: item.cantidad, subtotal: item.subtotal, precioUnitario: item.precio_venta };
    this.cdr.markForCheck();

    // Modo cámara fullscreen: el banner queda ESTÁTICO (no auto-dismiss). Es la única vía
    // para acceder al último producto y corregirlo — cada escaneo nuevo lo reemplaza, y
    // cerrarEscaner() lo limpia. En modo pistola sobre el catálogo, en cambio, sigue siendo
    // un feedback efímero (2.5s): ahí el panel de ítems en vivo ya muestra el carrito.
    if (!this.escaneando) {
      this.scanPreviewTimeout = setTimeout(() => { this.scanPreview = null; this.cdr.markForCheck(); }, 2500);
    }
  }

  incrementar(item: CartItem): boolean {
    if (item.tipo_venta === 'PESO') { this.editarCantidad(item); return true; }
    const factor = item.factor_conversion ?? 1;
    const stockUsado = this.stockUsadoPorProducto(item.id);
    const maxParaEste = Math.floor((item.stock_disponible - stockUsado + item.cantidad * factor) / factor);
    if (item.cantidad < maxParaEste) {
      this.actualizarCantidad(this.keyDe(item), item.cantidad + 1);
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
      this.actualizarCantidad(this.keyDe(item), item.cantidad - 1);
    } else {
      this.eliminar(item);
    }
  }

  async editarCantidad(item: CartItem): Promise<number | null> {
    const itemKey = this.keyDe(item);
    if (this.editandoItemKey === itemKey) return null; // evitar doble tap
    this.editandoItemKey = itemKey;
    this.cdr.markForCheck();

    const esPeso = item.tipo_venta === 'PESO';
    const factor = item.factor_conversion ?? 1;
    const stockUsadoOtros = this.carrito()
        .filter(i => i.id === item.id && this.keyDe(i) !== itemKey)
        .reduce((sum, i) => sum + i.cantidad * (i.factor_conversion ?? 1), 0);

    try {
      // Stock fresco de BD — solo online; offline el snapshot local es la única verdad
      // y esperar un fetch destinado a fallar congelaría el spinner con señal mala.
      if (this.network.isConnected()) {
        const stockFresco = await this.inventarioService.obtenerStockActual(item.id);
        if (stockFresco !== null && stockFresco !== item.stock_disponible) {
          this.carrito.update(items =>
            items.map(i => this.keyDe(i) === itemKey ? { ...i, stock_disponible: stockFresco } : i)
          );
          item = { ...item, stock_disponible: stockFresco };
        }
      }
    } finally {
      this.editandoItemKey = null;
      this.cdr.markForCheck();
    }

    // PESO admite fracciones (2.5 kg) — truncar solo cuando se vende por unidades
    const stockLibre = (item.stock_disponible - stockUsadoOtros) / factor;
    const maxStock = esPeso ? stockLibre : Math.floor(stockLibre);

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
    });

    await modal.present();
    const { data, role } = await modal.onDidDismiss<CantidadModalResult>();

    if (role === 'quitar') {
      this.eliminar(item);
      return 0; // 0 indica al caller que el item fue eliminado — debe limpiar su contador
    }

    if (role !== 'confirm' || !data) return null;

    this.actualizarCantidad(itemKey, data.cantidad);
    return data.cantidad;
  }

  eliminar(item: CartItem) {
    const key = this.keyDe(item);
    this.carrito.update(c => c.filter(i => this.keyDe(i) !== key));
  }

  /**
   * Corregir el producto recién escaneado desde su banner (ej. se escaneó de más).
   * Cierra el escáner y abre directo el modal de cantidad de ESE ítem — corrección en
   * 1 tap, sin tener que buscar el producto en el catálogo ni ir al carrito.
   */
  async corregirDesdeBanner() {
    const key = this.scanPreview?.itemKey;
    if (!key) return;

    // El item pudo haber sido eliminado entre el escaneo y el tap — resolver contra el
    // carrito vigente (no contra el snapshot del preview) para editar la fila real.
    const item = this.carrito().find(i => this.keyDe(i) === key);

    clearTimeout(this.scanPreviewTimeout);
    this.scanPreview = null;
    await this.cerrarEscaner(); // salir del modo cámara: el modal quedaría oculto tras él
    if (item) await this.editarCantidad(item);
  }


  // ==========================
  // BÚSQUEDA Y ESCÁNER (MANUAL)
  // ==========================

  toggleModoBusqueda() {
    this.modoBusqueda = this.modoBusqueda === 'codigo' ? 'nombre' : 'codigo';
    this.limpiarBusqueda();
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.cat-search-input');
      input?.focus();
    }, 50);
  }

  limpiarBusqueda() {
    this.buscarTexto.set('');
    this.cdr.markForCheck();
  }

  limpiarInputBusqueda() {
    this.limpiarBusqueda();
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
    // Agregar por código (pistola o tecleo manual) muestra el preview efímero del producto.
    this.origenEscaneoFisico = true;
    this.cdr.markForCheck();
    try {
      // Patrón cantidad.codigo (ej: 20.7891234 = 20 unidades del código "7891234")
      const matchRapido = texto.match(/^(\d+)\.(.+)$/);
      if (matchRapido) {
        const cantidad = parseInt(matchRapido[1], 10);
        const codigo = matchRapido[2].trim();
        if (cantidad > 0 && codigo) {
          const resultado = await this.resolverCodigo(codigo);
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

      // Código exacto — se agrega directo sin confirmación.
      const resultado = await this.resolverCodigo(texto);
      if (version !== this.searchVersion) return;
      if (resultado) {
        await this.agregarAlCarrito(resultado.producto, resultado.presentacion);
        this.buscarTexto.set('');
      } else {
        this.ui.showToast(`Código "${texto}" no encontrado`, 'warning');
      }
    } finally {
      this.origenEscaneoFisico = false;
      if (version === this.searchVersion) {
        this.buscando = false;
        this.cdr.markForCheck();
      }
    }
  }

  /** Despacha un producto elegido (catálogo o código): directo al carrito, o al modal
   *  de variantes reutilizado como selector de presentaciones si las tiene. */
  async seleccionarProductoBusqueda(producto: ProductoPOS, limpiar = true) {
    const presentaciones = producto.presentaciones ?? [];

    if (presentaciones.length === 0) {
      await this.agregarAlCarrito(producto);
    } else {
      await this.mostrarSelectorVariantes(producto.nombre, [producto], 'Selecciona cómo venderlo');
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

    // Favorito del grupo (all-or-nothing). Variantes: marca TODO el template. Presentaciones
    // (variantes=[producto], sin template): marca ese producto único (SKU).
    const templateId = variantes[0]?.producto_template_id ?? null;
    const esFavorito = variantes.length > 0 && variantes.every(v => v.favorito);
    const onToggleFavorito = async (favorito: boolean): Promise<boolean> => {
      const ok = templateId
        ? await this.productoService.toggleFavoritoTemplate(templateId, favorito)
        : !!(await this.productoService.toggleFavorito(variantes[0].id, favorito));
      if (ok) this.mutarFavoritoGrupoEnMemoria(variantes.map(v => v.id), favorito);
      return ok;
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
        esFavorito,
        onToggleFavorito,
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
    // Al cerrar, Android devuelve el foco a la <button> del catálogo que abrió el modal.
    // Si luego llega el Enter de un escaneo, esa card se re-activaría (reabriría el modal).
    // Blur preventivo: el foco queda en ningún elemento activable por teclado.
    (document.activeElement as HTMLElement | null)?.blur();
  }

  // ==========================
  // ESCÁNER FÍSICO (PISTOLA USB/BT)
  // ==========================
  // keydown (no keypress: está deprecado y Chrome/Edge no lo disparan de forma
  // confiable para todas las teclas). La pistola HID "teclea" el EAN + Enter en
  // ráfaga; este buffer captura el escaneo cuando NINGÚN input tiene el foco.
  /** ¿Hay un overlay de Ionic (modal/alert/action-sheet/loading/popover) abierto?
   *  Chequeo síncrono del DOM — un overlay presente NO tiene la clase `.overlay-hidden`
   *  que Ionic aplica mientras está oculto/saliendo. Cubre todos los overlays presentes
   *  y futuros sin instrumentar cada modalCtrl.create(). */
  private hayOverlayAbierto(): boolean {
    return !!document.querySelector(
      'ion-modal:not(.overlay-hidden), ion-alert:not(.overlay-hidden), ' +
      'ion-action-sheet:not(.overlay-hidden), ion-loading:not(.overlay-hidden), ' +
      'ion-popover:not(.overlay-hidden)'
    );
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    // Ignorar si la página no está activa (Ionic cachea páginas)
    if (!this.paginaActiva) return;

    // Hay un overlay abierto (modal de variantes/cantidad/cliente, alert, loading)
    // → NO procesar el escaneo global: el modal es un contexto modal y la pistola no
    // debe operar el catálogo por detrás (apilaba otro modal al escanear). Descartamos
    // también el buffer para no dejar restos que se procesen al cerrar el overlay.
    if (this.hayOverlayAbierto()) {
      this.barcodeBuffer = '';
      return;
    }

    // Si el usuario ya está enfocado en un input (ej. el searchbar), ignoramos:
    // ese input maneja el escaneo por su cuenta (onSearchKeyup) — evita duplicar.
    const target = event.target as HTMLElement;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'ION-INPUT' ||
        tag === 'ION-SEARCHBAR' || target.isContentEditable) {
      return;
    }

    if (event.key === 'Enter') {
      // El Enter de la pistola, si un <button> del catálogo tiene el foco (p.ej. la card
      // que abrió un modal y recuperó el foco al cerrarlo), dispararía un click sintético
      // en Android → reabría ese modal. Aquí el foco NO está en un input (ya salió por el
      // guard de tag arriba), así que cualquier Enter global es de la pistola: preventDefault
      // + blur neutraliza la activación fantasma, haya o no buffer que procesar.
      event.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      // Enter con buffer suficiente (EAN típico 8-13 dígitos) → procesar escaneo
      if (this.barcodeBuffer.length > 3) {
        void this.procesarCodigoRapido(this.barcodeBuffer);
      }
      this.barcodeBuffer = '';
    } else if (event.key.length === 1) { // 1 solo char: dígitos/letras. Descarta Shift, Tab, F1, etc.
      this.barcodeBuffer += event.key;
      clearTimeout(this.barcodeTimeout);
      // Pistolas HID escriben ~5-20ms por tecla. 100ms resetea si fue tipeo humano lento.
      this.barcodeTimeout = setTimeout(() => { this.barcodeBuffer = ''; }, 100);
    }
  }

  /**
   * Lookup dual del código en el catálogo YA cargado en memoria (catalogoCompleto).
   * Instantáneo (0 red) — el producto escaneado casi siempre está en el catálogo del POS.
   * Evita el round-trip a Supabase que causaba el "atranque" perceptible al escanear.
   * Devuelve null si no está en memoria → el caller cae al servicio (red) como fallback.
   */
  private buscarCodigoEnMemoria(codigo: string): { producto: ProductoPOS; presentacion?: ProductoPresentacion } | null {
    const cod = codigo.trim();
    if (!cod || !this.catalogoCompleto) return null;
    // 1. Match directo en el producto
    const prod = this.catalogoCompleto.find(p => p.codigo_barras === cod);
    if (prod) return { producto: prod };
    // 2. Match en presentaciones anidadas
    for (const p of this.catalogoCompleto) {
      const pres = p.presentaciones?.find(pr => pr.codigo_barras === cod && pr.activo);
      if (pres) return { producto: p, presentacion: pres };
    }
    return null;
  }

  /** Resuelve un código: memoria primero (instantáneo), red como fallback. Único punto
   *  para las 3 rutas de escaneo (listener global + input código exacto + cantidad.codigo). */
  private async resolverCodigo(codigo: string): Promise<{ producto: ProductoPOS; presentacion?: ProductoPresentacion } | null> {
    return this.buscarCodigoEnMemoria(codigo)
      ?? await this.inventarioService.buscarPorCodigoBarras(codigo);
  }

  async procesarCodigoRapido(codigo: string) {
    // Sin red: continuar solo si hay catálogo cacheado.
    if (!this.network.isConnected() && !(await this.catalogoLocal.tieneCache())) {
      this.ui.showToast('Sin conexión y sin catálogo disponible', 'danger');
      return;
    }

    try {
      const resultado = await this.resolverCodigo(codigo);
      if (resultado) {
        this.origenEscaneoFisico = true;
        try {
          await this.agregarAlCarrito(resultado.producto, resultado.presentacion);
        } finally {
          this.origenEscaneoFisico = false;
        }
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
    const iniciado = await this.barcodeScanner.startContinuous(
      (codigo) => {
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
      },
      undefined,
      // Área de detección: solo se leen códigos DENTRO del recuadro central. La cámara es
      // fullscreen (el plugin no la puede confinar en nativo), así que el filtro se hace por
      // coordenadas. Se recalcula en cada lectura leyendo el rect real del marco del overlay.
      () => this.areaEscaneoActual(),
    );

    if (!iniciado) { this.escaneando = false; this.cdr.markForCheck(); }
  }

  /** Rect del recuadro del escáner (`.scanner-frame` del overlay) en píxeles CSS, o null
   *  si no está montado. Alimenta el filtro de detection area del BarcodeScannerService. */
  private areaEscaneoActual(): AreaDeteccion | null {
    const el = document.querySelector('.scanner-frame');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  async cerrarEscaner() {
    // Bajar el flag y repintar PRIMERO: el @if(!escaneando) monta el catálogo de inmediato,
    // listo detrás de la máscara del escáner. Luego stop() quita `scanner-active` (revela el
    // WebView ya con el catálogo montado) y apaga la cámara. Así la vuelta al catálogo es
    // instantánea — antes se esperaba todo el stop() nativo antes de siquiera renderizar.
    this.escaneando = false;
    this.scanPreview = null;
    clearTimeout(this.scanPreviewTimeout);
    this.cdr.detectChanges();
    await this.barcodeScanner.stop();
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
      // A propósito NO se cierra tocando fuera (a diferencia de cantidad/variantes): es el
      // paso final con dinero de por medio — se cierra solo con la ✕ o un método de pago,
      // para no cancelarlo por un toque accidental en el backdrop.
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
    // FIADO anula el descuento → sus bases fiscales se calculan con factor 1 y total
    // bruto; usar los computed (descontados) dejaría base0+base15+iva ≠ total.
    const desglose = esFactura
      ? (esFiado ? this.calcularDesglose(1, this.subtotalBruto()) : this._desglose())
      : null;
    const payload: VentaPayload = {
      total:             totalFinal,
      subtotal:          desglose ? desglose.neto : this.subtotalBruto(),
      descuento,
      descuentoPct,
      metodoPago,
      tipoComprobante:   this.tipoComprobante,
      clienteId:         this.clienteSeleccionado?.id,
      baseIva0:          desglose?.base0 ?? 0,
      baseIva15:         desglose?.base15 ?? 0,
      ivaValor:          desglose?.iva ?? 0,
      idempotencyKey,
      // Instante real de la venta (UTC). Capturado aquí, al cobrar, para que una venta
      // encolada offline conserve su fecha original al sincronizarse — no la del momento
      // en que el sync corre (que podía ser el día siguiente). toISOString() es correcto:
      // guardamos un instante absoluto en un TIMESTAMPTZ, no una fecha local.
      fechaVenta:        new Date().toISOString(),
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
        // Overlay ANTES de limpiar: captura el total mientras el carrito aún existe.
        if (response.encolada) {
          // La señal cayó con el cobro en vuelo — la venta quedó en la cola local con la
          // misma idempotency key (reenviar es seguro) y se sincronizará sola.
          this.mostrarExitoVenta(undefined, true);
        } else {
          this.mostrarExitoVenta(response.numeroComprobante);
        }
        this.limpiarCarrito(true);
      } else {
        // El empleado ya "cerró" mentalmente la venta al confirmar el cobro — un toast
        // en la esquina puede pasar desapercibido y seguir con el carrito lleno creyendo
        // que ya cobró. Mismo peso que el success, sin auto-dismiss (debe leerlo y decidir).
        this.feedback.error({
          titulo: 'No se pudo registrar la venta',
          subtitulo: 'Intenta de nuevo',
        });
      }
    } catch (error) {
      await this.ui.hideLoading();
      if (error instanceof Error && error.message === 'SIN_TURNO') {
        await this.mostrarAlertSinTurno();
      } else if (error instanceof Error && /stock insuficiente/i.test(error.message)) {
        // Infrecuente y rompe el flujo esperado: el carrito se armó con stock que ya
        // no está disponible (otra caja vendió lo mismo en simultáneo). El empleado
        // necesita notar con claridad que debe revisar el carrito actualizado.
        this.feedback.warning({
          titulo: 'Stock insuficiente',
          subtitulo: 'El catálogo se actualizó con los valores reales',
        });
        this.refrescarCatalogo();
        this.logger.warn('PosPage', 'Venta rechazada por stock insuficiente en BD');
      } else {
        const mensaje = error instanceof Error ? error.message : 'Error inesperado al procesar la venta';
        this.feedback.error({ titulo: 'No se pudo registrar la venta', subtitulo: mensaje });
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
        this.mostrarExitoVenta(undefined, true);
        this.limpiarCarrito(true);
      } else {
        // Mismo criterio que el flujo online: el empleado ya confirmó el cobro.
        this.feedback.error({ titulo: 'No se pudo guardar la venta', subtitulo: 'Intenta de nuevo' });
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'SIN_TURNO') {
        await this.mostrarAlertSinTurno();
      } else {
        this.feedback.error({ titulo: 'No se pudo guardar la venta sin conexión' });
        this.logger.error('PosPage', 'Error al encolar venta offline', error);
      }
    }
  }

  /**
   * Muestra el overlay de éxito con el total cobrado (capturado ANTES de vaciar el
   * carrito, por eso se lee this.totalPagar() aquí). Reemplaza al toast como señal
   * principal de "venta cerrada" — usa el overlay genérico y reutilizable de
   * FeedbackOverlayService (shared, montado en AppComponent).
   */
  private mostrarExitoVenta(comprobante?: string | number | null, sincroniza = false) {
    this.feedback.success({
      titulo: '¡Venta registrada!',
      destacado: `$${this.currencyService.format(this.totalPagar())}`,
      subtitulo: comprobante
        ? `Comprobante #${comprobante}`
        : sincroniza ? 'Se sincronizará al volver la conexión' : undefined,
    });
  }

  /**
   * Vacía el carrito. Con ventaRealizada=true descuenta el stock vendido del catálogo
   * en memoria — sin refetch del catálogo completo por venta (la RPC más pesada de la
   * app). La verdad del servidor llega en el próximo enter a la página o pull-to-refresh.
   *
   * ventaRealizada=false es el vaciado MANUAL (menú ⋮ → Limpiar carrito, tras el Alert
   * de confirmación) — ahí sí se avisa con un toast neutro. Cuando es por venta, el
   * overlay de éxito (mostrarExitoVenta) ya es la señal principal; un segundo aviso
   * sería redundante.
   */
  limpiarCarrito(ventaRealizada = false) {
    // Conteo capturado ANTES de vaciar — se usa en el overlay de éxito del vaciado manual
    const articulosDescartados = this.totalArticulos();
    if (ventaRealizada) this.descontarStockLocal(this.carrito());
    this.carrito.set([]);
    this.buscarTexto.set('');
    if (this.volvioDesdeCatalogo && !this.esDesktop) {
      this.volvioDesdeCatalogo = false;
      this.vistaActual = 'catalogo';
    }
    // En background — no bloquea el vaciado (resetea al Consumidor Final)
    this.cargarCliente();
    if (!ventaRealizada) {
      this.feedback.success({
        titulo: 'Carrito vaciado',
        subtitulo: `${articulosDescartados} ${articulosDescartados === 1 ? 'artículo descartado' : 'artículos descartados'}`,
      });
    }
  }

  /** Descuenta optimistamente del catálogo en memoria las unidades base vendidas. */
  private descontarStockLocal(items: CartItem[]) {
    const vendido = new Map<string, number>();
    for (const it of items) {
      vendido.set(it.id, (vendido.get(it.id) ?? 0) + it.cantidad * (it.factor_conversion ?? 1));
    }
    const aplicar = (p: ProductoPOS) => {
      const unidades = vendido.get(p.id);
      return unidades ? { ...p, stock_actual: p.stock_actual - unidades } : p;
    };
    this.catalogoCompleto = this.catalogoCompleto?.map(aplicar) ?? null;
    this.productosCatalogo.update(prods => prods.map(aplicar));
    this.cdr.markForCheck();
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
    clearTimeout(this.totalAnimTimeout);
    clearTimeout(this.catalogoAnimTimeout);
    clearTimeout(this.incrementAnimTimeout);
    clearTimeout(this.addedAnimTimeout);
  }

  async ionViewWillEnter() {
    this.paginaActiva = true;
    this.buscarTexto.set('');
    this.cdr.markForCheck();

    // Primera activación: ngOnInit ya disparó config + cliente + catálogo. Sin este
    // guard, la RPC más pesada de la app (fn_catalogo_productos_pos) corría DOS veces
    // en paralelo al abrir el POS, y refrescarConfig invalidaba el config recién cargado.
    if (this.primeraActivacion) {
      this.primeraActivacion = false;
      await this.recuperarVentaPendiente();
      return;
    }

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
   *  Mismo núcleo que cargarCatalogo: snapshot completo, pintado progresivo y
   *  sincronización del stock de los ítems del carrito. */
  private async refrescarCatalogo() {
    try {
      await this.cargarCatalogoDesdeServidor();
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
      const { data, error } = await this.posService.verificarVentaPorIdempotencyKey(pendingKey);

      // supabase-js NO lanza en fallos de red — los devuelve en `error`. Sin confirmación
      // del servidor no se puede saber si la venta llegó: borrar la key aquí habilitaría
      // un recobro con key nueva → venta duplicada. Reintentar en el próximo enter.
      if (error) return;

      if (data) {
        // La venta SÍ se registró — limpiar todo
        localStorage.removeItem(PosPage.IDEMPOTENCY_STORAGE_KEY);
        this.ui.showToast('Venta pendiente confirmada exitosamente', 'success');
        this.limpiarCarrito(true);
      } else {
        // La venta NO se registró — limpiar key para que pueda reintentar con nueva key
        localStorage.removeItem(PosPage.IDEMPOTENCY_STORAGE_KEY);
      }
    } catch {
      // Excepción inesperada — mismo criterio que error de red: reintentar en el próximo enter
    }
  }

  ngOnDestroy() {
    if (this.escaneando) this.cerrarEscaner();
    clearTimeout(this.barcodeTimeout);
    clearTimeout(this.searchDebounce);
    clearTimeout(this.scanPreviewTimeout);
    clearTimeout(this.totalAnimTimeout);
    clearTimeout(this.catalogoAnimTimeout);
    clearTimeout(this.incrementAnimTimeout);
    clearTimeout(this.addedAnimTimeout);
    this.cancelarGesto();
  }

}
