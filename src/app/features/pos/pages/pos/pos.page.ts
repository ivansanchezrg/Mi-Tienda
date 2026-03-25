import { Component, OnInit, OnDestroy, inject, HostListener, NgZone, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent, IonHeader, IonTitle, IonToolbar,
  IonButtons, IonMenuButton, IonButton, IonIcon,
  IonFooter, IonList, IonItem, IonBadge, IonLabel, IonSpinner,
  IonItemSliding, IonItemOptions, IonItemOption,
  AlertController, ModalController, ViewDidLeave, ViewWillEnter
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { barcodeOutline, cartOutline, cashOutline, addOutline, removeOutline, trashOutline, cubeOutline, searchOutline, addCircleOutline, cardOutline, phonePortraitOutline, handRightOutline, receiptOutline, documentTextOutline, documentOutline, personOutline, chevronForwardOutline, refreshOutline, alertCircleOutline, closeOutline, checkmarkOutline, imageOutline } from 'ionicons/icons';
import { TipoComprobante } from '../../models/tipo-comprobante.enum';
import { OptionsMenuComponent, MenuOption } from '../../../../shared/components/options-menu/options-menu.component';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';
import { InventarioService } from '../../../inventario/services/inventario.service';
import { Producto, ProductoPOS } from '../../../inventario/models/producto.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { PosService, VentaPayload } from '../../services/pos.service';
import { CartItem } from '../../models/cart-item.model';
import { ClientesService } from '../../../clientes/services/clientes.service';
import { Cliente } from '../../../clientes/models/cliente.model';
import { SeleccionarClienteModalComponent } from '../../../clientes/components/seleccionar-cliente-modal/seleccionar-cliente-modal.component';
import { NetworkService } from '../../../../core/services/network.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { StorageService } from '../../../../core/services/storage.service';

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
    CommonModule, FormsModule,
    OptionsMenuComponent
  ]
})
export class PosPage implements OnInit, OnDestroy, ViewDidLeave, ViewWillEnter {
  @ViewChild(IonContent) content!: IonContent;

  private inventarioService = inject(InventarioService);
  public currencyService = inject(CurrencyService);
  private ui = inject(UiService);
  private posService = inject(PosService);
  private alertCtrl = inject(AlertController);
  private modalCtrl = inject(ModalController);
  private clientesService = inject(ClientesService);
  private ngZone = inject(NgZone);
  private network = inject(NetworkService);
  private logger = inject(LoggerService);
  public storageService = inject(StorageService);

  // Exponer enum al template (para el @if de mostrarDesglose)
  readonly TipoComprobante = TipoComprobante;

  lastAddedId: string | null = null;
  carrito: CartItem[] = [];
  buscarTexto = '';
  productosBusqueda: ProductoPOS[] = [];
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
  comprobanteOptions: MenuOption[] = [
    { label: 'Ticket', icon: 'receipt-outline', value: TipoComprobante.TICKET, active: true },
    { label: 'Nota de Venta', icon: 'document-text-outline', value: TipoComprobante.NOTA_VENTA, active: false },
    { label: 'Factura', icon: 'document-outline', value: TipoComprobante.FACTURA, active: false },
  ];

  // Buffer para pistola lectora física
  private barcodeBuffer = '';
  private barcodeTimeout: ReturnType<typeof setTimeout> | undefined;

  // Anti-duplicados para escáner de cámara
  private ultimoCodigoEscaneado = '';
  private ultimoTiempoEscaneado = 0;
  private procesandoEscaneo = false;

  // AudioContext reutilizable para beep
  private audioCtx: AudioContext | null = null;

  // Control de página activa (Ionic cachea páginas)
  private paginaActiva = true;

  constructor() {
    addIcons({
      barcodeOutline, cartOutline, cashOutline,
      addOutline, removeOutline, trashOutline,
      cubeOutline, searchOutline, addCircleOutline,
      cardOutline, phonePortraitOutline, handRightOutline,
      receiptOutline, documentTextOutline, documentOutline,
      personOutline, chevronForwardOutline, refreshOutline, alertCircleOutline, closeOutline, checkmarkOutline, imageOutline
    });
  }

  async ngOnInit() {
    await this.cargarCliente();
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

  /**
   * Total a cobrar = suma de subtotales.
   * precio_venta YA incluye IVA → precio final al cliente.
   */
  get totalPagar(): number {
    return this.carrito.reduce((sum, item) => sum + item.subtotal, 0);
  }

  // ── Getters de desglose fiscal (solo visibles en FACTURA) ────────────────

  /** Base gravada 0% (productos sin IVA) */
  get baseIva0(): number {
    return this.carrito
      .filter(i => !i.tiene_iva)
      .reduce((sum, i) => sum + i.subtotal, 0);
  }

  /** Base gravada 15% — precio con IVA ÷ 1.15 */
  get baseIva15(): number {
    const conIva = this.carrito
      .filter(i => i.tiene_iva)
      .reduce((sum, i) => sum + i.subtotal, 0);
    return Math.round((conIva / 1.15) * 100) / 100;
  }

  /** IVA 15% extraído del precio (NO sumado encima) */
  get ivaValor(): number {
    return Math.round((this.totalPagar - this.baseIva0 - this.baseIva15) * 100) / 100;
  }

  /** Subtotal neto = base0 + base15 (sin IVA) */
  get subtotalNeto(): number {
    return Math.round((this.baseIva0 + this.baseIva15) * 100) / 100;
  }

  /** Muestra desglose fiscal solo en FACTURA */
  get mostrarDesglose(): boolean {
    return this.tipoComprobante === TipoComprobante.FACTURA;
  }

  /** Callback del componente options-menu — actualiza el tipo y el checkmark */
  async onComprobanteOption(option: MenuOption) {
    this.tipoComprobante = option.value as TipoComprobante;
    this.comprobanteOptions = this.comprobanteOptions.map(o => ({
      ...o,
      active: o.value === option.value
    }));

    // FACTURA avisa si aún está en Consumidor Final
    if (this.tipoComprobante === TipoComprobante.FACTURA && this.clienteSeleccionado?.es_consumidor_final) {
      this.ui.showToast('Factura requiere un cliente con RUC o cédula', 'warning');
    }
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

  agregarAlCarrito(producto: ProductoPOS) {
    const existe = this.carrito.find(item => item.id === producto.id);
    if (existe) {
      if (existe.cantidad < producto.stock_actual) {
        this.incrementar(existe);
        this.feedbackEscaneo(existe.id);
        this.scrollToBottom();
      } else {
        this.ui.showToast('Stock insuficiente', 'warning');
      }
    } else {
      if (producto.stock_actual > 0) {
        this.carrito.push({
          ...producto,
          cantidad: 1,
          subtotal: producto.precio_venta
        });
        this.lastAddedId = producto.id;
        setTimeout(() => { this.lastAddedId = null; }, 600);
        this.feedbackEscaneo(producto.id);
        this.scrollToBottom();
      } else {
        this.ui.showToast('Producto sin stock', 'danger');
      }
    }
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
  agregarAlCarritoConCantidad(producto: ProductoPOS, cantidad: number) {
    const disponible = producto.stock_actual;
    if (disponible <= 0) {
      this.ui.showToast('Producto sin stock', 'danger');
      return;
    }

    const existe = this.carrito.find(item => item.id === producto.id);
    const yaEnCarrito = existe ? existe.cantidad : 0;
    const maximo = disponible - yaEnCarrito;
    const cantidadReal = Math.min(cantidad, maximo);

    if (cantidadReal <= 0) {
      this.ui.showToast('Stock insuficiente', 'warning');
      return;
    }

    if (existe) {
      existe.cantidad += cantidadReal;
      existe.subtotal = existe.cantidad * existe.precio_venta;
    } else {
      this.carrito.push({
        ...producto,
        cantidad: cantidadReal,
        subtotal: cantidadReal * producto.precio_venta
      });
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
      navigator.vibrate?.(40);
      this.playBeep();

      // Mostrar preview del producto escaneado (2.5s)
      const item = this.carrito.find(i => i.id === productoId);
      if (item) {
        clearTimeout(this.scanPreviewTimeout);
        this.scanPreview = { nombre: item.nombre, cantidad: item.cantidad, subtotal: item.subtotal, precioUnitario: item.precio_venta };
        this.scanPreviewTimeout = setTimeout(() => this.scanPreview = null, 2500);
      }
    }
  }

  /** Genera un beep corto con Web Audio API (reutiliza un solo AudioContext) */
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

  incrementar(item: CartItem) {
    if (item.cantidad < item.stock_actual) {
      item.cantidad++;
      item.subtotal = item.cantidad * item.precio_venta;
    } else {
      this.ui.showToast('Máximo stock alcanzado', 'warning');
    }
  }

  decrementar(item: CartItem) {
    if (item.cantidad > 1) {
      item.cantidad--;
      item.subtotal = item.cantidad * item.precio_venta;
    } else {
      this.eliminar(item);
    }
  }

  async editarCantidad(item: CartItem) {
    const precio = this.currencyService.format(item.precio_venta);
    const alert = await this.alertCtrl.create({
      header: item.nombre,
      message: `$${precio} c/u · Stock: ${item.stock_actual}`,
      inputs: [
        {
          name: 'cantidad',
          type: 'number',
          value: item.cantidad.toString(),
          min: 1,
          max: item.stock_actual,
          attributes: { inputmode: 'numeric' },
          placeholder: 'Cantidad'
        }
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Confirmar',
          handler: (data) => {
            const nueva = parseInt(data.cantidad, 10);
            if (!nueva || nueva < 1) {
              this.ui.showToast('Cantidad inválida', 'warning');
              return false;
            }
            if (nueva > item.stock_actual) {
              this.ui.showToast(`Stock máximo: ${item.stock_actual}`, 'warning');
              return false;
            }
            item.cantidad = nueva;
            item.subtotal = nueva * item.precio_venta;
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  eliminar(item: CartItem) {
    this.carrito = this.carrito.filter(i => i.id !== item.id);
  }

  // ==========================
  // BÚSQUEDA Y ESCÁNER (MANUAL)
  // ==========================

  toggleModoBusqueda() {
    this.modoBusqueda = this.modoBusqueda === 'codigo' ? 'nombre' : 'codigo';
    this.buscarTexto = '';
    this.productosBusqueda = [];
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
      if (!texto || texto.length < 2) { this.productosBusqueda = []; return; }
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

  // Enter en modo código también dispara (pistola lectora envía Enter al final)
  onSearchKeyup(event: KeyboardEvent) {
    if (this.modoBusqueda !== 'codigo') return;
    if (event.key === 'Enter') {
      clearTimeout(this.searchDebounce);
      const texto = this.buscarTexto?.trim();
      if (texto) this.buscarPorCodigo(texto);
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
          const producto = await this.inventarioService.obtenerProductoPorCodigo(codigo);
          if (producto) {
            this.agregarAlCarritoConCantidad(producto, cantidad);
            this.buscarTexto = '';
          } else {
            this.ui.showToast(`Código "${codigo}" no encontrado`, 'warning');
          }
        }
        return;
      }

      // Código exacto — se agrega directo sin confirmación
      const producto = await this.inventarioService.obtenerProductoPorCodigo(texto);
      if (producto) {
        this.agregarAlCarrito(producto);
        this.buscarTexto = '';
      } else {
        this.ui.showToast(`Código "${texto}" no encontrado`, 'warning');
      }
    } finally {
      this.buscando = false;
    }
  }

  // Clic en la lista de sugerencias (Resultados de Búsqueda)
  seleccionarProductoBusqueda(producto: ProductoPOS) {
    this.agregarAlCarrito(producto);
    this.buscarTexto = '';
    this.productosBusqueda = [];
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
        this.procesarCodigoRapido(this.barcodeBuffer);
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
      const producto = await this.inventarioService.obtenerProductoPorCodigo(codigo);
      if (producto) {
        this.agregarAlCarrito(producto);
      } else {
        this.ui.showToast(`EAN ${codigo} no encontrado en catálogo`, 'warning');
      }
    } catch {
      this.ui.showToast('Error de conexión. Verifica tu internet.', 'danger');
    }
  }

  async abrirEscanerCamara() {
    const { camera } = await BarcodeScanner.requestPermissions();
    if (camera !== 'granted') {
      this.ui.showToast('Permiso de cámara denegado', 'warning');
      return;
    }

    this.escaneando = true;
    document.body.classList.add('scanner-active');

    try {
      await BarcodeScanner.addListener('barcodesScanned', (event) => {
        const codigo = event.barcodes[0]?.rawValue;
        if (!codigo || this.procesandoEscaneo) return;

        // Anti-duplicados: ignora el mismo código dentro de 1.5 s
        const ahora = Date.now();
        if (codigo === this.ultimoCodigoEscaneado && ahora - this.ultimoTiempoEscaneado < 1500) return;

        this.procesandoEscaneo = true;
        this.ultimoCodigoEscaneado = codigo;
        this.ultimoTiempoEscaneado = ahora;

        this.ngZone.run(async () => {
          try {
            await this.procesarCodigoRapido(codigo);
          } finally {
            this.procesandoEscaneo = false;
          }
        });
      });
      await BarcodeScanner.startScan();
    } catch {
      await this.cerrarEscaner();
    }
  }

  async cerrarEscaner() {
    await BarcodeScanner.removeAllListeners();
    await BarcodeScanner.stopScan();
    document.body.classList.remove('scanner-active');
    this.escaneando = false;
    this.scanPreview = null;
    clearTimeout(this.scanPreviewTimeout);
  }

  async cobrar() {
    if (this.carrito.length === 0 || this.cobroEnProceso) return;

    if (!this.clienteSeleccionado?.id) {
      this.ui.showToast('Cliente no cargado. Toca el cliente para actualizar.', 'warning');
      return;
    }

    // Validación FACTURA: requiere cliente con identificación
    if (this.tipoComprobante === TipoComprobante.FACTURA && this.clienteSeleccionado?.es_consumidor_final) {
      this.ui.showToast('La Factura requiere seleccionar un cliente con RUC o cédula', 'warning');
      return;
    }

    // OptionsModalComponent — reemplaza ActionSheetController (no funciona en Android primera carga)
    const groups: ModalOptionGroup[] = [{
      options: [
        { label: 'Efectivo', icon: 'cash-outline', value: 'EFECTIVO' },
        { label: 'Tarjeta / DeUna', icon: 'card-outline', value: 'DEUNA' },
        { label: 'Transferencia', icon: 'phone-portrait-outline', value: 'TRANSFERENCIA' },
        { label: 'Fiado', icon: 'hand-right-outline', value: 'FIADO', color: 'danger' },
      ]
    }];

    const modal = await this.modalCtrl.create({
      component: OptionsModalComponent,
      componentProps: {
        title: `Cobrar $${this.currencyService.format(this.totalPagar)}`,
        subtitle: `${this.totalArticulos} ${this.totalArticulos === 1 ? 'artículo' : 'artículos'}`,
        groups
      },
      cssClass: 'options-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();

    if (data) {
      // Validación FIADO: requiere cliente real (no Consumidor Final)
      if (data === 'FIADO' && this.clienteSeleccionado?.es_consumidor_final) {
        this.ui.showToast('Para venta fiada debes seleccionar un cliente', 'warning');
        this.abrirSelectorCliente();
        return;
      }
      this.ejecutarCobro(data);
    }
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
      const esFactura = this.tipoComprobante === TipoComprobante.FACTURA;
      const payload: VentaPayload = {
        total:             this.totalPagar,
        subtotal:          esFactura ? this.subtotalNeto : this.totalPagar,
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
      const mensaje = error instanceof Error ? error.message : 'Error inesperado al procesar la venta';
      this.ui.showToast(mensaje, 'danger');
      this.logger.error('PosPage', 'Error en proceso de cobro', error);
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
    await this.recuperarVentaPendiente();
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
    this.audioCtx?.close().catch(() => {});
  }

}
