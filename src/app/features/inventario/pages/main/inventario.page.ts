import { Component, ElementRef, inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AlertController, NavController,
  IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonButton, IonIcon,
  IonContent, IonRefresher, IonRefresherContent,
  IonCard, IonCardContent, IonSkeletonText,
  IonInfiniteScroll, IonInfiniteScrollContent, IonFab, IonFabButton, IonSpinner
} from '@ionic/angular/standalone';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { Subscription } from 'rxjs';
import { addIcons } from 'ionicons';
import {
  addOutline,
  barcodeOutline,
  imageOutline,
  alertCircleOutline,
  cubeOutline,
  scanOutline,
  searchOutline,
  closeOutline,
  layersOutline,
  pricetagOutline,
  colorPaletteOutline,
  arrowUpOutline,
  chevronForwardOutline
} from 'ionicons/icons';
import { BarcodeScannerService } from '../../../../core/services/barcode-scanner.service';
import { PaginatedListPage } from '../../../../shared/pages/paginated-list.page';
import { PAGINATION_CONFIG } from '../../../../core/config/pagination.config';
import { InventarioService } from '../../services/inventario.service';
import { Producto } from '../../models/producto.model';
import { CategoriaProducto } from '../../models/categoria-producto.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { StorageService } from '../../../../core/services/storage.service';
import { ScannerOverlayComponent } from '../../../../shared/components/scanner-overlay/scanner-overlay.component';
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
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonButtons, IonMenuButton, IonTitle, IonButton, IonIcon,
    IonSpinner, IonContent, IonRefresher, IonRefresherContent,
    IonCard, IonCardContent, IonSkeletonText,
    IonInfiniteScroll, IonInfiniteScrollContent, IonFab, IonFabButton,
    EmptyStateComponent, ScannerOverlayComponent
  ]
})
export class InventarioPage extends PaginatedListPage<Producto> implements OnInit, OnDestroy {
  private inventarioService = inject(InventarioService);
  protected currencyService = inject(CurrencyService);
  private storageService = inject(StorageService);
  private navCtrl = inject(NavController);
  private alertCtrl = inject(AlertController);
  protected barcodeScanner = inject(BarcodeScannerService);

  @ViewChild('categoriaScroll') categoriaScrollRef!: ElementRef<HTMLDivElement>;

  protected readonly pageSize = PAGINATION_CONFIG.inventario.pageSize;
  readonly loadingMoreText = 'Cargando más productos...';

  categorias: CategoriaProducto[] = [];
  buscarTexto = '';
  categoriaSeleccionada?: string;
  templateSeleccionado?: { id: string; nombre: string };
  escaneando = false;
  mostrarDesactivados = false;
  readonly vistaAgrupada = true;
  readonly skeletonItems = Array(6);

  /** Items derivados para el grid — agrupa por template cuando vistaAgrupada=true */
  get itemsGrid(): InventarioItem[] {
    return this.vistaAgrupada && !this.mostrarDesactivados && !this.templateSeleccionado
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
          templateImagenUrl: p.producto_template?.imagen_url ?? p.imagen_url,
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

get filtroSeleccionado(): string {
    if (this.mostrarDesactivados) return 'desactivados';
    if (this.templateSeleccionado) return `tmpl-${this.templateSeleccionado.id}`;
    if (this.categoriaSeleccionada) return `cat-${this.categoriaSeleccionada}`;
    return 'todas';
  }

  private searchDebounce: ReturnType<typeof setTimeout> | undefined;
  private productoChangeSub?: Subscription;

  searchAbierto = false;

  constructor() {
    super();
    addIcons({
      addOutline,
      barcodeOutline,
      imageOutline,
      alertCircleOutline,
      cubeOutline,
      scanOutline,
      searchOutline,
      closeOutline,
      layersOutline,
      pricetagOutline,
      colorPaletteOutline,
      arrowUpOutline,
      chevronForwardOutline
    });
  }

  abrirSearch() {
    this.searchAbierto = true;
    setTimeout(() => {
      const input = document.querySelector('.inv-search-input') as HTMLInputElement;
      input?.focus();
    }, 260);
  }

  cerrarSearch() {
    this.searchAbierto = false;
    this.buscarTexto = '';
    this.categoriaSeleccionada = undefined;
    this.templateSeleccionado = undefined;
    this.mostrarDesactivados = false;
    clearTimeout(this.searchDebounce);
    this.cargar();
  }

  onSearchInputNativo(event: Event) {
    const input = event.target as HTMLInputElement;
    this.buscarTexto = input.value ?? '';
    this.aplicarFiltro();
  }

  async ngOnInit() {
    this.categorias = await this.inventarioService.obtenerCategorias();
    await this.cargar();

    // Escuchar cambios de producto desde la página de formulario
    this.productoChangeSub = this.inventarioService.onProductoChange$.subscribe(async event => {
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
      this.pageSize
    );
    return this.resolverImagenesLote(productos);
  }

  aplicarFiltro() {
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(async () => {
      this.categoriaSeleccionada = undefined;
      this.templateSeleccionado = undefined;
      this.mostrarDesactivados = false;

      await this.cargar();

      // 2️⃣ Auto-seleccionar categoría SOLO si hay texto y todos los
      //    resultados pertenecen a la misma — actualiza el label del filtro
      if (this.buscarTexto.trim() && this.items.length > 0) {
        const categoriaIds = new Set(this.items.map(p => p.categoria_id).filter(Boolean));
        if (categoriaIds.size === 1) {
          this.categoriaSeleccionada = [...categoriaIds][0]!;
        }
      }
    }, 450);
  }

  onFiltroChange(value: string) {
    this.templateSeleccionado = undefined;
    if (value === 'desactivados') {
      this.mostrarDesactivados = true;
      this.categoriaSeleccionada = undefined;
      this.buscarTexto = '';
    } else if (value === 'todas') {
      this.mostrarDesactivados = false;
      this.categoriaSeleccionada = undefined;
    } else if (value.startsWith('cat-')) {
      this.mostrarDesactivados = false;
      this.categoriaSeleccionada = value.replace('cat-', '');
    }
    this.cargar();
  }

  filtrarPorTemplate(template: { id: string; nombre: string }, event: MouseEvent) {
    event.stopPropagation();
    this.templateSeleccionado = template;
    this.categoriaSeleccionada = undefined;
    this.mostrarDesactivados = false;
    this.buscarTexto = '';
    this.cargar();
  }

  /** Tap en card de template agrupado → muestra las variantes filtradas */
  abrirTemplate(item: Extract<InventarioItem, { kind: 'template' }>) {
    this.templateSeleccionado = { id: item.templateId, nombre: item.templateNombre };
    this.categoriaSeleccionada = undefined;
    this.mostrarDesactivados = false;
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

  private async resolverImagenUrl(producto: Producto): Promise<Producto> {
    const url = await this.storageService.resolveImageUrl(producto.imagen_url);
    return { ...producto, imagen_url: url ?? undefined };
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

  ngOnDestroy() {
    if (this.escaneando) this.cerrarEscaner();
    clearTimeout(this.searchDebounce);
    this.productoChangeSub?.unsubscribe();
  }
}
