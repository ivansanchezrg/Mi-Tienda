import { Component, OnInit, OnDestroy, inject, HostListener, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent, IonHeader, IonTitle, IonToolbar,
  IonButtons, IonMenuButton, IonButton, IonIcon,
  IonSearchbar, IonFooter, IonList, IonItem, IonBadge, IonLabel, IonSpinner,
  IonItemSliding, IonItemOptions, IonItemOption,
  ActionSheetController, ModalController, ViewDidLeave, ViewWillEnter
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { barcodeOutline, cartOutline, cashOutline, addOutline, removeOutline, trashOutline, cubeOutline, searchOutline, addCircleOutline, cardOutline, phonePortraitOutline, handRightOutline, receiptOutline, documentTextOutline, documentOutline, personOutline, chevronForwardOutline, refreshOutline, alertCircleOutline, closeOutline } from 'ionicons/icons';
import { TipoComprobante } from '../../models/tipo-comprobante.enum';
import { OptionsMenuComponent, MenuOption } from '../../../../shared/components/options-menu/options-menu.component';
import { InventarioService } from '../../../inventario/services/inventario.service';
import { Producto } from '../../../inventario/models/producto.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { PosService, VentaPayload } from '../../services/pos.service';
import { CartItem } from '../../models/cart-item.model';
import { TurnosCajaService } from '../../../dashboard/services/turnos-caja.service';
import { ClientesService } from '../../../clientes/services/clientes.service';
import { Cliente } from '../../../clientes/models/cliente.model';
import { SeleccionarClienteModalComponent } from '../../../clientes/components/seleccionar-cliente-modal/seleccionar-cliente-modal.component';

@Component({
  selector: 'app-pos',
  templateUrl: './pos.page.html',
  styleUrls: ['./pos.page.scss'],
  standalone: true,
  imports: [
    IonContent, IonHeader, IonTitle, IonToolbar,
    IonButtons, IonMenuButton, IonButton, IonIcon,
    IonSearchbar, IonFooter, IonList, IonItem, IonBadge, IonLabel, IonSpinner,
    IonItemSliding, IonItemOptions, IonItemOption,
    CommonModule, FormsModule,
    OptionsMenuComponent
  ]
})
export class PosPage implements OnInit, OnDestroy, ViewDidLeave, ViewWillEnter {
  private inventarioService = inject(InventarioService);
  public currencyService = inject(CurrencyService);
  private ui = inject(UiService);
  private posService = inject(PosService);
  private actionSheetCtrl = inject(ActionSheetController);
  private modalCtrl = inject(ModalController);
  private clientesService = inject(ClientesService);
  private ngZone = inject(NgZone);

  // Exponer enum al template (para el @if de mostrarDesglose)
  readonly TipoComprobante = TipoComprobante;

  carrito: CartItem[] = [];
  buscarTexto = '';
  productosBusqueda: Producto[] = [];
  buscando = false;
  escaneando = false;
  ultimoItemAgregadoId = '';

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
  private barcodeTimeout: any;

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
      personOutline, chevronForwardOutline, refreshOutline, alertCircleOutline, closeOutline
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
    const { data } = await modal.onWillDismiss();
    if (data?.cliente) {
      this.clienteSeleccionado = data.cliente;
    }
  }

  agregarAlCarrito(producto: Producto) {
    const existe = this.carrito.find(item => item.id === producto.id);
    if (existe) {
      if (existe.cantidad < producto.stock_actual) {
        this.incrementar(existe);
        this.feedbackEscaneo(existe.id);
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
        this.feedbackEscaneo(producto.id);
      } else {
        this.ui.showToast('Producto sin stock', 'danger');
      }
    }
  }

  /** Vibración + beep + highlight verde al agregar producto (feedback para escáner) */
  private feedbackEscaneo(productoId: string) {
    if (this.escaneando) {
      navigator.vibrate?.(40);
      this.playBeep();
      this.ultimoItemAgregadoId = productoId;
      setTimeout(() => this.ultimoItemAgregadoId = '', 400);
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

  eliminar(item: CartItem) {
    this.carrito = this.carrito.filter(i => i.id !== item.id);
  }

  // ==========================
  // BÚSQUEDA Y ESCÁNER (MANUAL)
  // ==========================

  async buscarProducto(event: any) {
    const texto = event.detail.value?.trim();
    if (!texto) {
      this.productosBusqueda = [];
      return;
    }

    this.buscando = true;
    try {
      // 1. Intentar por código exacto (EAN)
      const productoCodigo = await this.inventarioService.obtenerProductoPorCodigo(texto);
      if (productoCodigo) {
        this.agregarAlCarrito(productoCodigo);
        this.buscarTexto = '';
        this.productosBusqueda = [];
        return;
      }

      // 2. Buscar por aproximación de nombre
      const productos = await this.inventarioService.obtenerProductos(texto);
      if (productos.length === 1) {
        this.agregarAlCarrito(productos[0]);
        this.buscarTexto = '';
        this.productosBusqueda = [];
      } else if (productos.length > 1) {
        this.productosBusqueda = productos;
      } else {
        this.productosBusqueda = [];
      }
    } finally {
      this.buscando = false;
    }
  }

  // Clic en la lista de sugerencias (Resultados de Búsqueda)
  seleccionarProductoBusqueda(producto: Producto) {
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
    const producto = await this.inventarioService.obtenerProductoPorCodigo(codigo);
    if (producto) {
      this.agregarAlCarrito(producto);
    } else {
      this.ui.showToast(`EAN ${codigo} no encontrado en catálogo`, 'warning');
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
  }

  private turnosService = inject(TurnosCajaService);

  async cobrar() {
    if (this.carrito.length === 0) return;

    if (!this.clienteSeleccionado?.id) {
      this.ui.showToast('Cliente no cargado. Toca el cliente para actualizar.', 'warning');
      return;
    }

    // Validación FACTURA: requiere cliente con identificación
    if (this.tipoComprobante === TipoComprobante.FACTURA && this.clienteSeleccionado?.es_consumidor_final) {
      this.ui.showToast('La Factura requiere seleccionar un cliente con RUC o cédula', 'warning');
      return;
    }

    // ActionSheet de confirmación + selección de método de pago
    const sheet = await this.actionSheetCtrl.create({
      header: `Confirmar cobro de $${this.currencyService.format(this.totalPagar)}`,
      subHeader: `${this.totalArticulos} ${this.totalArticulos === 1 ? 'artículo' : 'artículos'}`,
      buttons: [
        {
          text: 'Efectivo',
          icon: 'cash-outline',
          handler: () => this.ejecutarCobro('EFECTIVO')
        },
        {
          text: 'Tarjeta / DeUna',
          icon: 'card-outline',
          handler: () => this.ejecutarCobro('DEUNA')
        },
        {
          text: 'Transferencia',
          icon: 'phone-portrait-outline',
          handler: () => this.ejecutarCobro('TRANSFERENCIA')
        },
        {
          text: 'Fiado',
          icon: 'hand-right-outline',
          role: 'destructive',
          handler: () => this.ejecutarCobro('FIADO')
        },
        {
          text: 'Cancelar',
          role: 'cancel'
        }
      ]
    });

    await sheet.present();
  }

  private async ejecutarCobro(metodoPago: string) {
    // 🔥 Bloqueamos la pantalla INMEDIATAMENTE al elegir el método de pago 
    // para prevenir doble-clicks.
    await this.ui.showLoading();

    try {
      // 1. Validación proactiva de Turno Activo ANTES de enviar la venta
      const turno = await this.turnosService.obtenerTurnoActivo();
      if (!turno) {
        await this.ui.hideLoading(); // Cerrar antes de mostrar toast
        this.ui.showToast('No hay un turno de caja abierto. Abre la caja antes de cobrar.', 'warning');
        return;
      }

      // 2. Armar el payload con todos los campos fiscales correctos
      const esFatura = this.tipoComprobante === TipoComprobante.FACTURA;
      const payload: VentaPayload = {
        total:             this.totalPagar,
        subtotal:          esFatura ? this.subtotalNeto : this.totalPagar,
        metodoPago,
        tipoComprobante:   this.tipoComprobante,
        clienteId:         this.clienteSeleccionado?.id,
        baseIva0:          esFatura ? this.baseIva0  : 0,
        baseIva15:         esFatura ? this.baseIva15 : 0,
        ivaValor:          esFatura ? this.ivaValor  : 0,
      };

      // 3. Procesar la venta en Supabase (RPC)
      const response = await this.posService.procesarVenta(this.carrito, payload);

      // Siempre escondemos el loading al final, ANTES del toast de éxito
      await this.ui.hideLoading();

      if (response.success) {
        this.ui.showToast('Venta registrada ✨', 'success');
        this.limpiarCarrito();
      }
    } catch (error: any) {
      // SupabaseService ya intercepta errores de base de datos y muestra su propio Error/Toast rojo.
      // Aquí solo imprimimos el error de código TypeScript a nivel local si algo explota.
      await this.ui.hideLoading(); // Cerrar localmente por si acaso
      console.error('Error no esperado en el proceso de cobro (local):', error);
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
    // Ionic cachea páginas: desactivar pistola lectora y cerrar escáner al salir
    this.paginaActiva = false;
    if (this.escaneando) this.cerrarEscaner();
    clearTimeout(this.barcodeTimeout);
  }

  ionViewWillEnter() {
    this.paginaActiva = true;
  }

  ngOnDestroy() {
    // Limpieza total al destruir el componente
    if (this.escaneando) this.cerrarEscaner();
    clearTimeout(this.barcodeTimeout);
    this.audioCtx?.close().catch(() => {});
  }

}
