import { Component, OnInit, OnDestroy, inject, HostListener, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  IonContent, IonHeader, IonTitle, IonToolbar,
  IonButtons, IonMenuButton, IonButton, IonIcon,
  IonFooter, IonList, IonItem, IonBadge, IonLabel, IonSpinner,
  IonItemSliding, IonItemOptions, IonItemOption,
  IonRefresher, IonRefresherContent,
  AlertController, ModalController, ViewDidLeave, ViewWillEnter
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { BarcodeScannerService } from '../../../../core/services/barcode-scanner.service';
import { barcodeOutline, cartOutline, cashOutline, addOutline, removeOutline, trashOutline, cubeOutline, searchOutline, addCircleOutline, cardOutline, phonePortraitOutline, handRightOutline, receiptOutline, documentTextOutline, documentOutline, personOutline, chevronForwardOutline, refreshOutline, alertCircleOutline, closeOutline, checkmarkOutline, imageOutline, pricetagOutline, chevronDownCircleOutline } from 'ionicons/icons';
import { TipoComprobante } from '../../models/tipo-comprobante.enum';
import { OptionsMenuComponent, MenuOption } from '../../../../shared/components/options-menu/options-menu.component';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { InventarioService } from '../../../inventario/services/inventario.service';
import { ProductoPOS, ProductoPresentacion } from '../../../inventario/models/producto.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { PosService, VentaPayload } from '../../services/pos.service';
import { CartItem } from '../../models/cart-item.model';
import { ClientesService } from '../../../clientes/services/clientes.service';
import { Cliente } from '../../../clientes/models/cliente.model';
import { SeleccionarClienteModalComponent } from '../../../clientes/components/seleccionar-cliente-modal/seleccionar-cliente-modal.component';
import { CobrarModalComponent } from '../../components/cobrar-modal/cobrar-modal.component';
import { CantidadModalComponent, CantidadModalResult } from '../../components/cantidad-modal/cantidad-modal.component';
import { NetworkService } from '../../../../core/services/network.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { StorageService } from '../../../../core/services/storage.service';
import { ConfigService } from '../../../../core/services/config.service';
import { Configuracion } from '../../../configuracion/models/configuracion.model';

@Component({
  selector: 'app-pos',
  templateUrl: './pos.page.html',
  styleUrls: ['./pos.page.scss'],
  standalone: true,
  imports: [
    IonContent, IonHeader, IonTitle, IonToolbar,
    IonButtons, IonMenuButton, IonButton, IonIcon,
    IonFooter, IonList, IonItem, IonBadge, IonLabel, IonSpinner,
    IonItemSliding, IonItemOptions, IonItemOption,
    IonRefresher, IonRefresherContent,
    CommonModule, FormsModule,
    OptionsMenuComponent, EmptyStateComponent
  ]
})
export class PosPage implements OnInit, OnDestroy, ViewDidLeave, ViewWillEnter {
  @ViewChild(IonContent) content!: IonContent;
  @ViewChild('searchInput') searchInputRef!: ElementRef<HTMLInputElement>;

  private inventarioService = inject(InventarioService);
  public currencyService = inject(CurrencyService);
  private ui = inject(UiService);
  private posService = inject(PosService);
  private alertCtrl = inject(AlertController);
  private modalCtrl = inject(ModalController);
  private clientesService = inject(ClientesService);
  private barcodeScanner = inject(BarcodeScannerService);
  private network = inject(NetworkService);
  private logger = inject(LoggerService);
  private storageService = inject(StorageService);
  private configService = inject(ConfigService);
  private router = inject(Router);

  // Exponer enum al template (para el @if de mostrarDesglose)
  readonly TipoComprobante = TipoComprobante;

  lastAddedId: string | null = null;
  carrito: CartItem[] = [];
  buscarTexto = '';
  productosBusqueda: ProductoPOS[] = [];
  sugerenciaActiva = -1;
  buscando = false;
  modoBusqueda: 'codigo' | 'nombre' = 'codigo';
  private searchVersion = 0;
  escaneando = false;
  cobroEnProceso = false;
  scanPreview: { nombre: string; cantidad: number; subtotal: number; precioUnitario: number } | null = null;
  private scanPreviewTimeout: ReturnType<typeof setTimeout> | undefined;

  clienteSeleccionado: Cliente | null = null;
  cargandoCliente = false;
  errorCliente = false;

  /** Tipo de comprobante activo — controla desglose fiscal en el footer */
  tipoComprobante: TipoComprobante = TipoComprobante.TICKET;

  /** Opciones del menú ⋮ para el componente reutilizable */
  readonly ACCION_LIMPIAR = '__LIMPIAR__';

  comprobanteOptions: MenuOption[] = [
    { label: 'Ticket',       icon: 'receipt-outline',        value: TipoComprobante.TICKET,      active: true },
    { label: 'Nota de Venta',icon: 'document-text-outline',  value: TipoComprobante.NOTA_VENTA,  active: false },
    { label: 'Factura',      icon: 'document-outline',       value: TipoComprobante.FACTURA,     active: false },
    { label: '',             icon: '',                       value: '__sep__',                   active: false, separator: true },
    { label: 'Limpiar carrito', icon: 'trash-outline',       value: '__LIMPIAR__',               active: false, color: 'danger' },
  ];

  /** Handler unificado del menú ⋮ */
  async onComprobanteOption(option: MenuOption) {
    if (option.value === this.ACCION_LIMPIAR) {
      if (this.carrito.length === 0) return;
      await this.confirmarLimpiarCarrito();
      return;
    }
    // Cambio de tipo de comprobante
    this.tipoComprobante = option.value as TipoComprobante;
    this.comprobanteOptions = this.comprobanteOptions.map(o => ({
      ...o,
      active: o.value === this.tipoComprobante
    }));
  }

  /** Pide confirmación antes de vaciar el carrito */
  private async confirmarLimpiarCarrito() {
    const alert = await this.alertCtrl.create({
      header: 'Limpiar carrito',
      message: `¿Descartás los ${this.totalArticulos} artículos del carrito?`,
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
      receiptOutline, documentTextOutline, documentOutline,
      personOutline, chevronForwardOutline, refreshOutline, alertCircleOutline, closeOutline, checkmarkOutline, imageOutline, pricetagOutline, chevronDownCircleOutline
    });
  }

  async ngOnInit() {
    await Promise.all([
      this.cargarCliente(),
      this.cargarConfig()
    ]);
  }

  private async cargarConfig() {
    this.appConfig = await this.configService.get();
  }

  async cargarCliente() {
    this.cargandoCliente = true;
    this.errorCliente = false;
    try {
      this.clienteSeleccionado = await this.clientesService.obtenerConsumidorFinal();
      if (!this.clienteSeleccionado?.id) this.errorCliente = true;
    } catch {
      this.errorCliente = true;
    } finally {
      this.cargandoCliente = false;
    }
  }

  // ==========================
  // LÓGICA DEL CARRITO
  // ==========================

  get totalArticulos(): number {
    return this.carrito.reduce((sum, item) => sum + item.cantidad, 0);
  }

  /** Subtotal bruto = suma de subtotales del carrito (sin descuento). */
  get subtotalBruto(): number {
    return this.carrito.reduce((sum, item) => sum + item.subtotal, 0);
  }

  /**
   * Descuento automático: se aplica si está habilitado en config
   * y el subtotal bruto supera el umbral mínimo.
   */
  get descuentoAplicado(): number {
    if (!this.appConfig?.pos_descuentos_habilitados) return 0;
    if (this.subtotalBruto < this.appConfig.pos_umbral_monto_descuento) return 0;
    const descuento = this.subtotalBruto * (this.appConfig.pos_descuento_maximo_pct / 100);
    return Math.round(descuento * 100) / 100;
  }

  /** Porcentaje de descuento configurado (para mostrar en el template). */
  get descuentoPct(): number {
    return this.appConfig?.pos_descuento_maximo_pct ?? 0;
  }

  /** Descuentos habilitados en config — controla chip en header */
  get descuentoActivo(): boolean {
    return !!this.appConfig?.pos_descuentos_habilitados;
  }

  /** Monto que falta para alcanzar el umbral de descuento (0 si ya lo superó o no aplica) */
  get faltaParaDescuento(): number {
    if (!this.descuentoActivo) return 0;
    const umbral = this.appConfig!.pos_umbral_monto_descuento;
    const falta = umbral - this.subtotalBruto;
    return falta > 0 ? Math.round(falta * 100) / 100 : 0;
  }

  /** Mostrar upselling: carrito con items, cerca del umbral (falta ≤30%) pero sin alcanzarlo */
  get mostrarUpselling(): boolean {
    if (!this.descuentoActivo || this.carrito.length === 0) return false;
    const umbral = this.appConfig!.pos_umbral_monto_descuento;
    const falta = this.faltaParaDescuento;
    return falta > 0 && falta <= umbral * 0.3;
  }

  /**
   * Total a cobrar = subtotal bruto - descuento.
   * precio_venta YA incluye IVA → precio final al cliente.
   */
  get totalPagar(): number {
    return Math.round((this.subtotalBruto - this.descuentoAplicado) * 100) / 100;
  }

  // ── Getters de desglose fiscal (solo visibles en FACTURA) ────────────────
  // El descuento se distribuye proporcionalmente entre base0 y base15.

  /** Montos brutos por grupo IVA (antes de descuento) — uso interno */
  private get _brutoIva0(): number {
    return this.carrito.filter(i => !i.tiene_iva).reduce((sum, i) => sum + i.subtotal, 0);
  }
  private get _brutoConIva(): number {
    return this.carrito.filter(i => i.tiene_iva).reduce((sum, i) => sum + i.subtotal, 0);
  }

  /** Factor de descuento: proporción que queda tras aplicar descuento */
  private get _factorDescuento(): number {
    return this.subtotalBruto > 0 ? this.totalPagar / this.subtotalBruto : 1;
  }

  /** Base gravada 0% (productos sin IVA, con descuento proporcional) */
  get baseIva0(): number {
    return Math.round(this._brutoIva0 * this._factorDescuento * 100) / 100;
  }

  /** Base gravada según tarifa IVA configurada — (precio con IVA × factor descuento) ÷ divisor */
  get baseIva15(): number {
    const conIvaDescontado = this._brutoConIva * this._factorDescuento;
    return Math.round((conIvaDescontado / this._ivaDivisor) * 100) / 100;
  }

  /** IVA extraído del precio (NO sumado encima) — usa tarifa de configuración */
  get ivaValor(): number {
    return Math.round((this.totalPagar - this.baseIva0 - this.baseIva15) * 100) / 100;
  }

  /** Divisor para extraer base sin IVA. Ej: iva=15% → divisor=1.15 */
  private get _ivaDivisor(): number {
    const pct = this.appConfig?.pos_iva_porcentaje ?? 15;
    return 1 + pct / 100;
  }

  /** Subtotal neto = base0 + base15 (sin IVA) */
  get subtotalNeto(): number {
    return Math.round((this.baseIva0 + this.baseIva15) * 100) / 100;
  }

  /** Muestra desglose fiscal solo en FACTURA */
  get mostrarDesglose(): boolean {
    return this.tipoComprobante === TipoComprobante.FACTURA;
  }


  async abrirSelectorCliente() {
    if (this.errorCliente || !this.clienteSeleccionado?.id) {
      await this.cargarCliente();
      if (this.errorCliente) {
        this.ui.showToast('No se pudo cargar el cliente. Verifica tu conexión.', 'danger');
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
    }
  }

  async agregarAlCarrito(producto: ProductoPOS, presentacion?: ProductoPresentacion) {
    // PESO: si ya está en carrito, editar; si no, agregar nuevo
    if (producto.tipo_venta === 'PESO') {
      const existePeso = this.carrito.find(item => item.id === producto.id);
      if (existePeso) {
        await this.editarCantidad(existePeso);
      } else {
        await this.pedirCantidadPeso(producto);
      }
      return;
    }

    const stockBase = producto.stock_actual;
    const factor = presentacion?.factor_conversion ?? 1;
    const precioVenta = presentacion?.precio_venta ?? producto.precio_venta;

    // Cuantas unidades base ya estan comprometidas en el carrito para este producto
    const stockUsado = this.stockUsadoPorProducto(producto.id);
    const stockLibre = stockBase - stockUsado;
    const maxUnidades = Math.floor(stockLibre / factor);

    const existe = this.carrito.find(item =>
        item.id === producto.id &&
        item.presentacion_id === (presentacion?.id ?? undefined)
    );

    if (existe) {
      // Recalcular max considerando lo que ya tiene este item
      const stockLibreSinEste = stockBase - stockUsado + (existe.cantidad * factor);
      const maxParaEste = Math.floor(stockLibreSinEste / factor);
      if (existe.cantidad < maxParaEste) {
        this.incrementar(existe);
        this.feedbackEscaneo(existe.id);
        this.scrollToBottom();
      } else {
        this.ui.showToast('Stock insuficiente', 'warning');
      }
    } else {
      if (maxUnidades > 0) {
        const prod = this.resolverImagen(producto);
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
        this.carrito.push(item);
        this.lastAddedId = producto.id;
        setTimeout(() => { this.lastAddedId = null; }, 600);
        this.feedbackEscaneo(producto.id);
        this.scrollToBottom();
      } else {
        this.ui.showToast('Producto sin stock', 'danger');
      }
    }
  }

  /** Resuelve la URL pública de la imagen del producto (si el path es relativo) */
  private resolverImagen(producto: ProductoPOS): ProductoPOS {
    if (producto.imagen_url && !producto.imagen_url.startsWith('http')) {
      return { ...producto, imagen_url: this.storageService.getPublicUrl(producto.imagen_url, 'productos') ?? undefined };
    }
    return producto;
  }

  /** Calcula cuantas unidades base de un producto estan comprometidas en el carrito */
  private stockUsadoPorProducto(productoId: string): number {
    return this.carrito
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
        esEdicion: !!itemExistente
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      cssClass: 'bottom-sheet-modal',
      backdropDismiss: false
    });

    await modal.present();
    const { data, role } = await modal.onDidDismiss<CantidadModalResult>();
    if (role !== 'confirm' || !data) return;

    const cantRedondeada = data.cantidad;
    if (itemExistente) {
      itemExistente.cantidad += cantRedondeada;
      itemExistente.subtotal = Math.round(itemExistente.cantidad * itemExistente.precio_venta * 100) / 100;
    } else {
      const prod = this.resolverImagen(producto);
      this.carrito.push({
        ...prod,
        cantidad: cantRedondeada,
        subtotal: Math.round(cantRedondeada * producto.precio_venta * 100) / 100,
        stock_disponible: producto.stock_actual
      });
      this.lastAddedId = producto.id;
      setTimeout(() => { this.lastAddedId = null; }, 600);
    }
    this.feedbackEscaneo(producto.id);
    this.scrollToBottom();
  }

  private scrollToBottom() {
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

    const existe = this.carrito.find(item =>
        item.id === producto.id &&
        item.presentacion_id === (presentacion?.id ?? undefined)
    );

    // Recalcular max incluyendo lo que ya tiene este item
    const stockLibreConEste = existe ? stockLibre + (existe.cantidad * factor) : stockLibre;
    const maxParaEste = Math.floor(stockLibreConEste / factor);
    const yaEnCarrito = existe ? existe.cantidad : 0;
    const cantidadReal = Math.min(cantidad, maxParaEste - yaEnCarrito);

    if (cantidadReal <= 0) {
      this.ui.showToast('Stock insuficiente', 'warning');
      return;
    }

    if (existe) {
      existe.cantidad += cantidadReal;
      existe.subtotal = Math.round(existe.cantidad * existe.precio_venta * 100) / 100;
    } else {
      const prod = this.resolverImagen(producto);
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
      this.carrito.push(item);
      this.lastAddedId = producto.id;
      setTimeout(() => { this.lastAddedId = null; }, 600);
    }

    if (cantidadReal < cantidad) {
      this.ui.showToast(`Solo se agregaron ${cantidadReal} (stock máximo)`, 'warning');
    }

    this.feedbackEscaneo(producto.id);
    this.scrollToBottom();
  }

  /** Vibración + beep + preview efímero al agregar producto (feedback para escáner) */
  private feedbackEscaneo(productoId: string) {
    if (this.escaneando) {
      this.barcodeScanner.feedback();

      // Mostrar preview del producto escaneado (2.5s)
      const item = this.carrito.find(i => i.id === productoId);
      if (item) {
        clearTimeout(this.scanPreviewTimeout);
        this.scanPreview = { nombre: item.nombre, cantidad: item.cantidad, subtotal: item.subtotal, precioUnitario: item.precio_venta };
        this.scanPreviewTimeout = setTimeout(() => this.scanPreview = null, 2500);
      }
    }
  }

  incrementar(item: CartItem) {
    if (item.tipo_venta === 'PESO') {
      this.editarCantidad(item);
      return;
    }
    const factor = item.factor_conversion ?? 1;
    const stockUsado = this.stockUsadoPorProducto(item.id);
    const stockLibreSinEste = item.stock_disponible - stockUsado + (item.cantidad * factor);
    const maxParaEste = Math.floor(stockLibreSinEste / factor);
    if (item.cantidad < maxParaEste) {
      item.cantidad++;
      item.subtotal = Math.round(item.cantidad * item.precio_venta * 100) / 100;
    } else {
      this.ui.showToast('Máximo stock alcanzado', 'warning');
    }
  }

  decrementar(item: CartItem) {
    if (item.tipo_venta === 'PESO') {
      this.editarCantidad(item);
      return;
    }
    if (item.cantidad > 1) {
      item.cantidad--;
      item.subtotal = Math.round(item.cantidad * item.precio_venta * 100) / 100;
    } else {
      this.eliminar(item);
    }
  }

  async editarCantidad(item: CartItem) {
    const esPeso = item.tipo_venta === 'PESO';
    const factor = item.factor_conversion ?? 1;
    // Stock libre para este item = stock total - usado por otros items del mismo producto
    const stockUsadoOtros = this.carrito
        .filter(i => i.id === item.id && i !== item)
        .reduce((sum, i) => sum + i.cantidad * (i.factor_conversion ?? 1), 0);
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
        esEdicion: true
      },
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      cssClass: 'bottom-sheet-modal',
      backdropDismiss: false
    });

    await modal.present();
    const { data, role } = await modal.onDidDismiss<CantidadModalResult>();
    if (role !== 'confirm' || !data) return;

    item.cantidad = data.cantidad;
    item.subtotal = Math.round(item.cantidad * item.precio_venta * 100) / 100;
  }

  eliminar(item: CartItem) {
    this.carrito = this.carrito.filter(i => i !== item);
  }

  // ==========================
  // BÚSQUEDA Y ESCÁNER (MANUAL)
  // ==========================

  toggleModoBusqueda() {
    this.modoBusqueda = this.modoBusqueda === 'codigo' ? 'nombre' : 'codigo';
    this.buscarTexto = '';
    this.productosBusqueda = [];
    // Foco después del cambio para que Android abra el teclado correcto
    setTimeout(() => this.searchInputRef?.nativeElement?.focus(), 50);
  }

  limpiarBusqueda() {
    this.buscarTexto = '';
    this.productosBusqueda = [];
  }

  // Dispatcher: según el modo activo llama a la lógica correspondiente
  private searchDebounce: ReturnType<typeof setTimeout> | undefined;
  onSearchInput(event: Event) {
    const texto = (event.target as HTMLInputElement).value?.trim();

    if (this.modoBusqueda === 'nombre') {
      if (!texto || texto.length < 2) { this.productosBusqueda = []; this.sugerenciaActiva = -1; return; }
      clearTimeout(this.searchDebounce);
      this.searchDebounce = setTimeout(() => this.buscarPorNombre(texto), 600);
    } else {
      clearTimeout(this.searchDebounce);
      if (!texto) return;
      const esBulk = /^(\d+)\.(.+)$/.test(texto);
      // Bulk (ej: 10.2): dispara con cualquier longitud de código
      // Código solo: espera ≥8 chars para no disparar con dígitos sueltos
      if (!esBulk && texto.length < 8) return;
      this.searchDebounce = setTimeout(() => this.buscarPorCodigo(texto), 300);
    }
  }

  // Enter en modo código dispara búsqueda (pistola lectora envía Enter al final)
  // En modo nombre: ↑/↓ navegan sugerencias, Enter selecciona la activa (o la primera)
  onSearchKeyup(event: KeyboardEvent) {
    if (this.modoBusqueda === 'codigo') {
      if (event.key === 'Enter') {
        clearTimeout(this.searchDebounce);
        const texto = this.buscarTexto?.trim();
        if (texto) this.buscarPorCodigo(texto);
      }
      return;
    }

    // Modo nombre — navegación por teclado
    const total = this.productosBusqueda.length;
    if (total === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.sugerenciaActiva = Math.min(this.sugerenciaActiva + 1, total - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.sugerenciaActiva = Math.max(this.sugerenciaActiva - 1, 0);
    } else if (event.key === 'Enter') {
      const idx = this.sugerenciaActiva >= 0 ? this.sugerenciaActiva : 0;
      void this.seleccionarProductoBusqueda(this.productosBusqueda[idx]);
    }
  }

  private async buscarPorNombre(texto: string) {
    if (!this.network.isConnected()) {
      this.ui.showToast('Sin conexión a internet', 'danger');
      return;
    }

    const version = ++this.searchVersion;
    this.buscando = true;
    try {
      const resultados = await this.inventarioService.buscarProductosPOS(texto);
      // Descartar si llegó una búsqueda más reciente mientras esperábamos
      if (version !== this.searchVersion) return;
      this.productosBusqueda = resultados;
    } finally {
      if (version === this.searchVersion) this.buscando = false;
    }
  }

  private async buscarPorCodigo(texto: string) {
    if (!this.network.isConnected()) {
      this.ui.showToast('Sin conexión a internet', 'danger');
      return;
    }

    this.buscando = true;
    try {
      // Patrón cantidad.codigo (ej: 20.7891234 = 20 unidades del código "7891234")
      const matchRapido = texto.match(/^(\d+)\.(.+)$/);
      if (matchRapido) {
        const cantidad = parseInt(matchRapido[1], 10);
        const codigo = matchRapido[2].trim();
        if (cantidad > 0 && codigo) {
          const resultado = await this.inventarioService.buscarPorCodigoBarras(codigo);
          if (resultado) {
            await this.agregarAlCarritoConCantidad(resultado.producto, cantidad, resultado.presentacion);
            this.buscarTexto = '';
          } else {
            this.ui.showToast(`Código "${codigo}" no encontrado`, 'warning');
          }
        }
        return;
      }

      // Código exacto — se agrega directo sin confirmación
      const resultado = await this.inventarioService.buscarPorCodigoBarras(texto);
      if (resultado) {
        await this.agregarAlCarrito(resultado.producto, resultado.presentacion);
        this.buscarTexto = '';
      } else {
        this.ui.showToast(`Código "${texto}" no encontrado`, 'warning');
      }
    } finally {
      this.buscando = false;
    }
  }

  // Clic en la lista de sugerencias — las presentaciones ya vienen en el objeto
  async seleccionarProductoBusqueda(producto: ProductoPOS) {
    const presentaciones = producto.presentaciones ?? [];

    if (presentaciones.length === 0) {
      await this.agregarAlCarrito(producto);
    } else {
      await this.mostrarSelectorPresentacion(producto, presentaciones);
    }

    this.buscarTexto = '';
    this.productosBusqueda = [];
    this.sugerenciaActiva = -1;
  }

  /** OptionsModal: unidad suelta + una opción por presentación */
  private async mostrarSelectorPresentacion(producto: ProductoPOS, presentaciones: ProductoPresentacion[]) {
    const groups: ModalOptionGroup[] = [{
      options: [
        {
          label: `Unidad suelta  ·  $${this.currencyService.format(producto.precio_venta)}`,
          icon: 'cube-outline',
          value: '__unidad__'
        },
        ...presentaciones.map(pres => ({
          label: `${pres.nombre}  ·  $${this.currencyService.format(pres.precio_venta)}`,
          icon: 'pricetag-outline',
          value: pres.id
        }))
      ]
    }];

    const modal = await this.modalCtrl.create({
      component: OptionsModalComponent,
      componentProps: { title: producto.nombre, subtitle: 'Selecciona cómo venderlo', groups },
      cssClass: 'options-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });

    await modal.present();
    const { data } = await modal.onDidDismiss<string>();
    if (!data) return;

    if (data === '__unidad__') {
      await this.agregarAlCarrito(producto);
    } else {
      const pres = presentaciones.find(p => p.id === data);
      if (pres) await this.agregarAlCarrito(producto, pres);
    }
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
    if (!this.network.isConnected()) {
      this.ui.showToast('Sin conexión a internet', 'danger');
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
    const iniciado = await this.barcodeScanner.startContinuous((codigo) => {
      if (this.procesandoEscaneo) return;

      // Anti-duplicados: ignora el mismo código dentro de 1.5s
      const ahora = Date.now();
      if (codigo === this.ultimoCodigoEscaneado && ahora - this.ultimoTiempoEscaneado < 1500) return;

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

    if (!iniciado) this.escaneando = false;
  }

  async cerrarEscaner() {
    await this.barcodeScanner.stop();
    this.escaneando = false;
    this.scanPreview = null;
    clearTimeout(this.scanPreviewTimeout);
  }

  async cobrarEfectivo() {
    if (this.carrito.length === 0 || this.cobroEnProceso) return;

    if (!this.clienteSeleccionado?.id) {
      this.ui.showToast('Cliente no cargado. Toca el cliente para actualizar.', 'warning');
      return;
    }

    // FACTURA requiere cliente con identificación
    if (this.tipoComprobante === TipoComprobante.FACTURA && this.clienteSeleccionado.es_consumidor_final) {
      this.ui.showToast('La Factura requiere seleccionar un cliente con RUC o cédula', 'warning');
      return;
    }

    const turnoActivo = await this.posService.hayTurnoActivo();
    if (!turnoActivo) {
      await this.mostrarAlertSinTurno();
      return;
    }

    const modal = await this.modalCtrl.create({
      component: CobrarModalComponent,
      componentProps: {
        total: this.totalPagar,
        subtotal: this.subtotalBruto,
        descuento: this.descuentoAplicado,
        descuentoPct: this.descuentoPct,
        totalArticulos: this.totalArticulos,
        esConsumidorFinal: false,
        iniciarEnEfectivo: true
      },
      backdropDismiss: false
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (!data) return;
    if (data.confirmado) this.ejecutarCobro(data.metodoPago);
  }

  async cobrar() {
    if (this.carrito.length === 0 || this.cobroEnProceso) return;

    if (!this.clienteSeleccionado?.id) {
      this.ui.showToast('Cliente no cargado. Toca el cliente para actualizar.', 'warning');
      return;
    }

    // Si es consumidor final, forzar selección de cliente antes de abrir el modal
    if (this.clienteSeleccionado.es_consumidor_final) {
      this.ui.showToast('Seleccioná un cliente para continuar', 'warning');
      await this.abrirSelectorCliente();
      if (this.clienteSeleccionado.es_consumidor_final) return; // canceló o no eligió
    }

    // Verificar turno activo antes de abrir el modal de cobro
    const turnoActivo = await this.posService.hayTurnoActivo();
    if (!turnoActivo) {
      await this.mostrarAlertSinTurno();
      return;
    }

    // Validación FACTURA: requiere cliente con identificación
    if (this.tipoComprobante === TipoComprobante.FACTURA && this.clienteSeleccionado.es_consumidor_final) {
      this.ui.showToast('La Factura requiere seleccionar un cliente con RUC o cédula', 'warning');
      return;
    }

    const modal = await this.modalCtrl.create({
      component: CobrarModalComponent,
      componentProps: {
        total: this.totalPagar,
        subtotal: this.subtotalBruto,
        descuento: this.descuentoAplicado,
        descuentoPct: this.descuentoPct,
        totalArticulos: this.totalArticulos,
        esConsumidorFinal: false
      },
      backdropDismiss: false
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();

    if (data?.confirmado) {
      this.ejecutarCobro(data.metodoPago);
    }
  }

  private async mostrarAlertSinTurno() {
    const alert = await this.alertCtrl.create({
      header: 'Caja Chica cerrada',
      message: 'Debes abrir la Caja Chica antes de registrar ventas.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Ir a Inicio',
          handler: () => this.router.navigate(['/home'])
        }
      ]
    });
    await alert.present();
  }

  private static readonly IDEMPOTENCY_STORAGE_KEY = 'pos_pending_idempotency_key';

  private async ejecutarCobro(metodoPago: string) {
    if (this.cobroEnProceso) return;
    this.cobroEnProceso = true;
    await this.ui.showLoading();

    try {
      // 1. Generar idempotency key y persistir ANTES del RPC
      const idempotencyKey = crypto.randomUUID();
      localStorage.setItem(PosPage.IDEMPOTENCY_STORAGE_KEY, idempotencyKey);

      // 2. Armar el payload con todos los campos fiscales correctos
      //    FIADO no lleva descuento — son beneficios mutuamente excluyentes
      const esFiado = metodoPago === 'FIADO';
      const descuento = esFiado ? 0 : this.descuentoAplicado;
      const descuentoPct = esFiado ? 0 : this.descuentoPct;
      const totalFinal = esFiado ? this.subtotalBruto : this.totalPagar;
      const esFactura = this.tipoComprobante === TipoComprobante.FACTURA;
      const payload: VentaPayload = {
        total:             totalFinal,
        subtotal:          esFactura ? this.subtotalNeto : this.subtotalBruto,
        descuento,
        descuentoPct,
        metodoPago,
        tipoComprobante:   this.tipoComprobante,
        clienteId:         this.clienteSeleccionado?.id,
        baseIva0:          esFactura ? this.baseIva0  : 0,
        baseIva15:         esFactura ? this.baseIva15 : 0,
        ivaValor:          esFactura ? this.ivaValor  : 0,
        idempotencyKey,
      };

      // 3. Procesar la venta en Supabase (RPC) — turno se valida dentro del servicio
      const response = await this.posService.procesarVenta(this.carrito, payload);

      await this.ui.hideLoading();

      if (response.success) {
        // Limpiar idempotency key — venta confirmada
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
      } else {
        const mensaje = error instanceof Error ? error.message : 'Error inesperado al procesar la venta';
        this.ui.showToast(mensaje, 'danger');
        this.logger.error('PosPage', 'Error en proceso de cobro', error);
      }
    } finally {
      this.cobroEnProceso = false;
    }
  }

  async limpiarCarrito() {
    this.carrito = [];
    this.buscarTexto = '';
    this.productosBusqueda = [];
    // Resetear cliente y comprobante a sus defaults tras cada venta
    this.tipoComprobante = TipoComprobante.TICKET;
    this.comprobanteOptions = this.comprobanteOptions.map(o => ({
      ...o,
      active: o.value === TipoComprobante.TICKET
    }));
    await this.cargarCliente();
  }

  // ==========================
  // LIFECYCLE — limpieza de recursos
  // ==========================

  ionViewDidLeave() {
    this.paginaActiva = false;
    if (this.escaneando) this.cerrarEscaner();
    clearTimeout(this.barcodeTimeout);
    clearTimeout(this.searchDebounce);
  }

  async ionViewWillEnter() {
    this.paginaActiva = true;
    this.productosBusqueda = [];
    this.buscarTexto = '';
    await Promise.all([
      this.recuperarVentaPendiente(),
      this.refrescarConfig(),
    ]);
  }

  /** Refresca config silenciosamente al volver al POS (ej: admin cambió descuentos) */
  private async refrescarConfig() {
    this.configService.invalidar();
    this.appConfig = await this.configService.get();
  }

  /** Pull-to-refresh: recarga config sin perder el carrito */
  async handleRefresh(event: CustomEvent) {
    await this.refrescarConfig();
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
