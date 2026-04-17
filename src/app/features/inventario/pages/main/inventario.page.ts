import { Component, inject, NgZone, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertController, IonicModule, ModalController, NavController } from '@ionic/angular';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { Subscription } from 'rxjs';
import { addIcons } from 'ionicons';
import {
  addOutline,
  searchOutline,
  barcodeOutline,
  imageOutline,
  alertCircleOutline,
  cubeOutline,
  scanOutline,
  closeOutline,
  ellipsisVerticalOutline,
  createOutline,
  trashOutline,
  addCircleOutline,
  chevronDownOutline,
  layersOutline,
  pricetagOutline
} from 'ionicons/icons';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { PaginatedListPage } from '../../../../shared/pages/paginated-list.page';
import { PAGINATION_CONFIG } from '../../../../core/config/pagination.config';
import { InventarioService } from '../../services/inventario.service';
import { Producto } from '../../models/producto.model';
import { CategoriaProducto } from '../../models/categoria-producto.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { StorageService } from '../../../../core/services/storage.service';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';

@Component({
  selector: 'app-inventario',
  templateUrl: './inventario.page.html',
  styleUrls: ['./inventario.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule, EmptyStateComponent]
})
export class InventarioPage extends PaginatedListPage<Producto> implements OnInit, OnDestroy {
  private inventarioService = inject(InventarioService);
  public currencyService = inject(CurrencyService);
  private storageService = inject(StorageService);
  private navCtrl = inject(NavController);
  private alertCtrl = inject(AlertController);
  private modalCtrl = inject(ModalController);
  private ngZone = inject(NgZone);

  protected readonly pageSize = PAGINATION_CONFIG.inventario.pageSize;
  readonly loadingMoreText = 'Cargando más productos...';

  categorias: CategoriaProducto[] = [];
  buscarTexto = '';
  categoriaSeleccionada?: number;
  escaneando = false;
  mostrarDesactivados = false;

  get filtroSeleccionado(): string {
    if (this.mostrarDesactivados) return 'desactivados';
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

  private audioCtx: AudioContext | null = null;
  private searchDebounce: ReturnType<typeof setTimeout> | undefined;
  private productoChangeSub?: Subscription;

  constructor() {
    super();
    addIcons({
      addOutline,
      searchOutline,
      barcodeOutline,
      imageOutline,
      alertCircleOutline,
      cubeOutline,
      scanOutline,
      closeOutline,
      ellipsisVerticalOutline,
      createOutline,
      trashOutline,
      addCircleOutline,
      chevronDownOutline,
      layersOutline,
      pricetagOutline
    });
  }

  async ngOnInit() {
    this.categorias = await this.inventarioService.obtenerCategorias();
    await this.cargar();

    // Escuchar cambios de producto desde la página de formulario
    this.productoChangeSub = this.inventarioService.onProductoChange$.subscribe(event => {
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
      // Sin paginación: los desactivados suelen ser pocos
      if (page > 0) return [];
      const productos = await this.inventarioService.obtenerProductosDesactivados();
      return productos.map(p => this.resolverImagenUrl(p));
    }
    const productos = await this.inventarioService.obtenerProductos(
      this.buscarTexto || undefined,
      this.categoriaSeleccionada === 0 ? undefined : this.categoriaSeleccionada,
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
      // 1️⃣ Reset SIEMPRE primero — garantiza que limpiar el texto
      //    devuelve el filtro a "Todas las categorías" sin estado residual
      this.categoriaSeleccionada = undefined;
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
    if (value === 'desactivados') {
      this.mostrarDesactivados = true;
      this.categoriaSeleccionada = undefined;
      this.buscarTexto = '';
    } else if (value === 'todas') {
      this.mostrarDesactivados = false;
      this.categoriaSeleccionada = undefined;
    } else if (value.startsWith('cat-')) {
      this.mostrarDesactivados = false;
      this.categoriaSeleccionada = Number(value.replace('cat-', ''));
    }
    this.cargar();
  }

  limpiarBusqueda() {
    this.buscarTexto = '';
    this.categoriaSeleccionada = undefined;
    this.mostrarDesactivados = false;
    this.cargar();
  }


  irACrear(codigoBarras?: string) {
    const extras = codigoBarras ? { queryParams: { codigo: codigoBarras } } : {};
    this.navCtrl.navigateForward('/inventario/nuevo', extras);
  }

  private resolverImagenUrl(producto: Producto): Producto {
    if (producto.imagen_url && !producto.imagen_url.startsWith('http')) {
      return { ...producto, imagen_url: this.storageService.getPublicUrl(producto.imagen_url, 'productos') || undefined };
    }
    return producto;
  }

  irAEditar(producto: Producto) {
    this.navCtrl.navigateForward(`/inventario/editar/${producto.id}`);
  }

  // ==========================
  // SELECTOR DE CATEGORÍA (OptionsModalComponent)
  // ==========================

  async abrirSelectorCategoria() {
    const groups: ModalOptionGroup[] = [];

    // Grupo principal: todas
    groups.push({
      options: [
        { label: 'Todas las categorías', value: 'todas' }
      ]
    });

    // Grupo: categorías
    if (this.categorias.length > 0) {
      groups.push({
        title: 'Categorías',
        options: this.categorias.map(cat => ({
          label: cat.nombre,
          value: `cat-${cat.id}`
        }))
      });
    }

    // Grupo: otros
    groups.push({
      title: 'Otros',
      options: [
        { label: 'Productos desactivados', value: 'desactivados', color: 'danger' }
      ]
    });

    const modal = await this.modalCtrl.create({
      component: OptionsModalComponent,
      componentProps: {
        title: 'Filtrar por categoría',
        groups,
        selectedValue: this.filtroSeleccionado
      },
      cssClass: 'options-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();

    if (data) {
      this.onFiltroChange(data);
    }
  }

  // ==========================
  // MENÚ OPCIONES CATEGORÍAS (...)
  // ==========================

  async abrirOpcionesCategorias() {
    const cat = this.categorias.find(c => c.id === this.categoriaSeleccionada);
    const groups: ModalOptionGroup[] = [];

    // Grupo: acciones generales
    const generales: ModalOptionGroup = {
      options: [
        { label: 'Nueva categoría', icon: 'add-circle-outline', value: 'crear' }
      ]
    };
    groups.push(generales);

    // Grupo: acciones sobre la categoría seleccionada
    if (cat) {
      groups.push({
        title: `Categoría: ${cat.nombre}`,
        options: [
          { label: 'Renombrar', icon: 'create-outline', value: 'renombrar', subtitle: `Cambiar nombre de "${cat.nombre}"` },
          { label: 'Eliminar', icon: 'trash-outline', value: 'eliminar', color: 'danger', subtitle: 'Solo si no tiene productos' }
        ]
      });
    }

    const modal = await this.modalCtrl.create({
      component: OptionsModalComponent,
      componentProps: {
        title: 'Categorías',
        subtitle: cat ? `Seleccionada: ${cat.nombre}` : 'Gestionar categorías de productos',
        groups
      },
      cssClass: 'options-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();

    if (!data) return;
    switch (data) {
      case 'crear': this.crearCategoria(); break;
      case 'renombrar': if (cat) this.renombrarCategoria(cat); break;
      case 'eliminar': if (cat) this.confirmarDesactivarCategoria(cat); break;
    }
  }

  // ==========================
  // CATEGORÍAS
  // ==========================

  async crearCategoria() {
    const alert = await this.alertCtrl.create({
      header: 'Nueva categoría',
      inputs: [{ name: 'nombre', type: 'text', placeholder: 'Nombre de la categoría' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Crear',
          handler: async (data) => {
            const nombre = data.nombre?.trim();
            if (!nombre) {
              this.ui.showToast('El nombre es requerido', 'warning');
              return false;
            }
            await this.inventarioService.crearCategoria(nombre);
            this.categorias = await this.inventarioService.obtenerCategorias();
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  private async renombrarCategoria(cat: CategoriaProducto) {
    const alert = await this.alertCtrl.create({
      header: 'Renombrar categoría',
      inputs: [{ name: 'nombre', type: 'text', value: cat.nombre, placeholder: 'Nuevo nombre' }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Guardar',
          handler: async (data) => {
            const nombre = data.nombre?.trim();
            if (!nombre) {
              this.ui.showToast('El nombre es requerido', 'warning');
              return false;
            }
            await this.inventarioService.renombrarCategoria(cat.id, nombre);
            this.categorias = await this.inventarioService.obtenerCategorias();
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  private async confirmarDesactivarCategoria(cat: CategoriaProducto) {
    const { activos, inactivos } = await this.inventarioService.contarProductosPorCategoria(cat.id);

    if (activos > 0) {
      this.ui.showToast(`No se puede eliminar: tiene ${activos} producto(s) activo(s)`, 'warning');
      return;
    }

    if (inactivos > 0) {
      this.ui.showToast(
        `No se puede eliminar: tiene ${inactivos} producto(s) desactivado(s) que aún pertenecen a esta categoría.`,
        'warning'
      );
      return;
    }

    const alert = await this.alertCtrl.create({
      header: 'Eliminar categoría',
      message: `¿Eliminar "${cat.nombre}"? Esta acción no se puede deshacer.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: async () => {
            await this.inventarioService.desactivarCategoria(cat.id);
            if (this.categoriaSeleccionada === cat.id) {
              this.categoriaSeleccionada = undefined;
            }
            this.categorias = await this.inventarioService.obtenerCategorias();
            await this.cargar();
          }
        }
      ]
    });
    await alert.present();
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
    const { camera } = await BarcodeScanner.requestPermissions();
    if (camera !== 'granted') {
      this.ui.showToast('Permiso de cámara denegado', 'warning');
      return;
    }

    this.escaneando = true;
    document.body.classList.add('scanner-active');

    try {
      await BarcodeScanner.addListener('barcodesScanned', (event) => {
        this.ngZone.run(async () => {
          const codigo = event.barcodes[0]?.rawValue;
          if (!codigo) return;
          navigator.vibrate?.(40);
          this.playBeep();
          await this.cerrarEscaner();
          await this.procesarCodigoEscaneado(codigo);
        });
      });
      await BarcodeScanner.startScan({
        formats: [
          BarcodeFormat.Ean13, BarcodeFormat.Ean8,
          BarcodeFormat.Code128, BarcodeFormat.UpcA,
          BarcodeFormat.UpcE, BarcodeFormat.Code39,
        ]
      });
    } catch {
      await this.cerrarEscaner();
    }
  }

  private async procesarCodigoEscaneado(codigo: string) {
    const productoExistente = await this.inventarioService.obtenerProductoPorCodigo(codigo);

    if (!productoExistente) {
      this.irACrear(codigo);
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
          handler: () => this.navCtrl.navigateForward(`/inventario/kardex/${productoExistente.id}`)
        },
        { text: 'Cancelar', role: 'cancel' }
      ]
    });
    await alert.present();
  }

  async cerrarEscaner() {
    await BarcodeScanner.removeAllListeners();
    await BarcodeScanner.stopScan();
    document.body.classList.remove('scanner-active');
    this.escaneando = false;
  }

  private playBeep() {
    try {
      if (!this.audioCtx || this.audioCtx.state === 'closed') {
        this.audioCtx = new AudioContext();
      }
      const oscillator = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = 1000;
      gain.gain.value = 1.0;
      oscillator.connect(gain);
      gain.connect(this.audioCtx.destination);
      oscillator.start();
      oscillator.stop(this.audioCtx.currentTime + 0.12);
    } catch { /* silencioso si falla */ }
  }

  ngOnDestroy() {
    if (this.escaneando) this.cerrarEscaner();
    clearTimeout(this.searchDebounce);
    this.audioCtx?.close().catch(() => {});
    this.productoChangeSub?.unsubscribe();
  }
}
