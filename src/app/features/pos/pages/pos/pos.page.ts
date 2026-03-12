import { Component, OnInit, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent, IonHeader, IonTitle, IonToolbar,
  IonButtons, IonMenuButton, IonButton, IonIcon,
  IonSearchbar, IonFooter, IonList, IonItem, IonBadge, IonLabel, IonSpinner,
  IonItemSliding, IonItemOptions, IonItemOption,
  ActionSheetController, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { barcodeOutline, cartOutline, cashOutline, addOutline, removeOutline, trashOutline, cubeOutline, searchOutline, addCircleOutline, cardOutline, phonePortraitOutline, handRightOutline, receiptOutline, documentTextOutline, documentOutline, personOutline, chevronForwardOutline } from 'ionicons/icons';
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
export class PosPage implements OnInit {
  private inventarioService = inject(InventarioService);
  public currencyService = inject(CurrencyService);
  private ui = inject(UiService);
  private posService = inject(PosService);
  private actionSheetCtrl = inject(ActionSheetController);
  private modalCtrl = inject(ModalController);
  private clientesService = inject(ClientesService);

  // Exponer enum al template (para el @if de mostrarDesglose)
  readonly TipoComprobante = TipoComprobante;

  carrito: CartItem[] = [];
  buscarTexto = '';
  productosBusqueda: Producto[] = [];
  buscando = false;

  clienteSeleccionado: Cliente | null = null;

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

  constructor() {
    addIcons({
      barcodeOutline, cartOutline, cashOutline,
      addOutline, removeOutline, trashOutline,
      cubeOutline, searchOutline, addCircleOutline,
      cardOutline, phonePortraitOutline, handRightOutline,
      receiptOutline, documentTextOutline, documentOutline,
      personOutline, chevronForwardOutline
    });
  }

  async ngOnInit() {
    this.clienteSeleccionado = await this.clientesService.obtenerConsumidorFinal();
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
      } else {
        this.ui.showToast('Producto sin stock', 'danger');
      }
    }
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
    this.ui.showToast('El escáner por cámara requiere un plugin especial. Usa scanner físico.', 'warning');
  }

  private turnosService = inject(TurnosCajaService);

  async cobrar() {
    if (this.carrito.length === 0) return;

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
    this.clienteSeleccionado = await this.clientesService.obtenerConsumidorFinal();
  }

}
