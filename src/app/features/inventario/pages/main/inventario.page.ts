import { Component, ElementRef, inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule, NavController } from '@ionic/angular';
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
  closeOutline,
  layersOutline,
  pricetagOutline,
  colorPaletteOutline
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

@Component({
  selector: 'app-inventario',
  templateUrl: './inventario.page.html',
  styleUrls: ['./inventario.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, EmptyStateComponent, ScannerOverlayComponent]
})
export class InventarioPage extends PaginatedListPage<Producto> implements OnInit, OnDestroy {
  private inventarioService = inject(InventarioService);
  public currencyService = inject(CurrencyService);
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
  readonly skeletonItems = Array(6);

  get filtroSeleccionado(): string {
    if (this.mostrarDesactivados) return 'desactivados';
    if (this.templateSeleccionado) return `tmpl-${this.templateSeleccionado.id}`;
    if (this.categoriaSeleccionada) return `cat-${this.categoriaSeleccionada}`;
    return 'todas';
  }

  get filtroLabel(): string {
    if (this.mostrarDesactivados) return 'Desactivados';
    if (this.categoriaSeleccionada) {
      const cat = this.categorias.find(c => c.id === this.categoriaSeleccionada);
      return cat?.nombre || 'Categoría';
    }
    return 'Todas las categorías';
  }

  private searchDebounce: ReturnType<typeof setTimeout> | undefined;
  private productoChangeSub?: Subscription;

  constructor() {
    super();
    addIcons({
      addOutline,
      barcodeOutline,
      imageOutline,
      alertCircleOutline,
      cubeOutline,
      scanOutline,
      closeOutline,
      layersOutline,
      pricetagOutline,
      colorPaletteOutline
    });
  }

  async ngOnInit() {
    this.categorias = await this.inventarioService.obtenerCategorias();
    await this.cargar();

    // Escuchar cambios de producto desde la página de formulario
    this.productoChangeSub = this.inventarioService.onProductoChange$.subscribe(event => {
      if (event.tipo === 'RECARGA') {
        this.cargar();
        return;
      }
      if (event.tipo === 'DESACTIVADO') {
        this.items = this.items.filter(p => p.id !== event.producto.id);
        return;
      }
      const producto = this.resolverImagenUrl(event.producto);
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
      return productos.map(p => this.resolverImagenUrl(p));
    }
    const productos = await this.inventarioService.obtenerProductos(
      this.buscarTexto || undefined,
      this.categoriaSeleccionada,
      this.templateSeleccionado?.id,
      page,
      this.pageSize
    );
    return productos.map(p => this.resolverImagenUrl(p));
  }

  onSearchInput(event: CustomEvent) {
    // Leer el valor del evento directamente — evita desfase con ngModel
    // cubre: tipeo, borrado tecla a tecla, y el botón X del searchbar
    this.buscarTexto = (event.detail.value ?? '').toString();
    this.aplicarFiltro();
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

  limpiarFiltroTemplate() {
    this.templateSeleccionado = undefined;
    this.cargar();
  }

  limpiarBusqueda() {
    this.buscarTexto = '';
    this.categoriaSeleccionada = undefined;
    this.mostrarDesactivados = false;
    this.cargar();
  }


  irACrear() {
    this.navCtrl.navigateForward(ROUTES.inventario.nuevo);
  }

  private irACrearSimple(codigoBarras: string) {
    this.navCtrl.navigateForward(ROUTES.inventario.nuevoSimple, { queryParams: { codigo: codigoBarras } });
  }

  private resolverImagenUrl(producto: Producto): Producto {
    if (producto.imagen_url && !producto.imagen_url.startsWith('http')) {
      return { ...producto, imagen_url: this.storageService.getPublicUrl(producto.imagen_url, 'productos') || undefined };
    }
    return producto;
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
      this.irACrearSimple(codigo);
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
