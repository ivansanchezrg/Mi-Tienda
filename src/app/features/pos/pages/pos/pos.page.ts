import { Component, OnInit, OnDestroy, inject, HostListener, NgZone, ViewChild, ElementRef } from '@angular/core';
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
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { barcodeOutline, cartOutline, cashOutline, addOutline, removeOutline, trashOutline, cubeOutline, searchOutline, addCircleOutline, cardOutline, phonePortraitOutline, handRightOutline, receiptOutline, documentTextOutline, documentOutline, personOutline, chevronForwardOutline, refreshOutline, alertCircleOutline, closeOutline, checkmarkOutline, imageOutline, pricetagOutline, chevronDownCircleOutline, ellipsisHorizontalOutline } from 'ionicons/icons';
import { TipoComprobante } from '../../models/tipo-comprobante.enum';
import { OptionsMenuComponent, MenuOption } from '../../../../shared/components/options-menu/options-menu.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { InventarioService } from '../../../inventario/services/inventario.service';
import { Producto, ProductoPOS } from '../../../inventario/models/producto.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { PosService, VentaPayload } from '../../services/pos.service';
import { CartItem } from '../../models/cart-item.model';
import { ClientesService } from '../../../clientes/services/clientes.service';
import { Cliente } from '../../../clientes/models/cliente.model';
import { SeleccionarClienteModalComponent } from '../../../clientes/components/seleccionar-cliente-modal/seleccionar-cliente-modal.component';
import { CobrarModalComponent } from '../../components/cobrar-modal/cobrar-modal.component';
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
  private ngZone = inject(NgZone);
  private network = inject(NetworkService);
  private logger = inject(LoggerService);
  public storageService = inject(StorageService);
  private configService = inject(ConfigService);
  private router = inject(Router);

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
      personOutline, chevronForwardOutline, refreshOutline, alertCircleOutline, closeOutline, checkmarkOutline, imageOutline, pricetagOutline, chevronDownCircleOutline, ellipsisHorizontalOutline
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

  /** Base gravada 15% — (precio con IVA × factor descuento) ÷ 1.15 */
  get baseIva15(): number {
    const conIvaDescontado = this._brutoConIva * this._factorDescuento;
    return Math.round((conIvaDescontado / 1.15) * 100) / 100;
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

  async cobrarEfectivo() {
    if (this.carrito.length === 0 || this.cobroEnProceso) return;

    if (!this.clienteSeleccionado?.id) {
      this.ui.showToast('Cliente no cargado. Toca el cliente para actualizar.', 'warning');
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
        esConsumidorFinal: !!this.clienteSeleccionado?.es_consumidor_final,
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

    // Verificar turno activo antes de abrir el modal de cobro
    const turnoActivo = await this.posService.hayTurnoActivo();
    if (!turnoActivo) {
      await this.mostrarAlertSinTurno();
      return;
    }

    // Validación FACTURA: requiere cliente con identificación
    if (this.tipoComprobante === TipoComprobante.FACTURA && this.clienteSeleccionado?.es_consumidor_final) {
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
        esConsumidorFinal: !!this.clienteSeleccionado?.es_consumidor_final
      },
      backdropDismiss: false
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();

    if (!data) return;

    // FIADO con consumidor final → abrir selector de cliente
    if (data.necesitaCliente) {
      this.ui.showToast('Para venta fiada debes seleccionar un cliente', 'warning');
      this.abrirSelectorCliente();
      return;
    }

    if (data.confirmado) {
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
    this.audioCtx?.close().catch(() => {});
  }

}
