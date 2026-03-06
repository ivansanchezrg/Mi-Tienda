import { Component, OnInit, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent, IonHeader, IonTitle, IonToolbar,
  IonButtons, IonMenuButton, IonButton, IonIcon,
  IonSearchbar, IonFooter, IonList, IonItem, IonBadge, IonLabel, IonSpinner,
  IonItemSliding, IonItemOptions, IonItemOption,
  ActionSheetController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { barcodeOutline, cartOutline, cashOutline, addOutline, removeOutline, trashOutline, cubeOutline, searchOutline, addCircleOutline, cardOutline, phonePortraitOutline, handRightOutline } from 'ionicons/icons';
import { InventarioService } from '../../../inventario/services/inventario.service';
import { Producto } from '../../../inventario/models/producto.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { PosService } from '../../services/pos.service';
import { CartItem } from '../../models/cart-item.model';
import { TurnosCajaService } from '../../../dashboard/services/turnos-caja.service';

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
    CommonModule, FormsModule
  ]
})
export class PosPage implements OnInit {
  private inventarioService = inject(InventarioService);
  public currencyService = inject(CurrencyService);
  private ui = inject(UiService);
  private posService = inject(PosService);
  private actionSheetCtrl = inject(ActionSheetController);

  carrito: CartItem[] = [];
  buscarTexto = '';
  productosBusqueda: Producto[] = [];
  buscando = false;

  // Buffer para pistola lectora física
  private barcodeBuffer = '';
  private barcodeTimeout: any;

  constructor() {
    addIcons({
      barcodeOutline, cartOutline, cashOutline,
      addOutline, removeOutline, trashOutline,
      cubeOutline, searchOutline, addCircleOutline,
      cardOutline, phonePortraitOutline, handRightOutline
    });
  }

  ngOnInit() {
  }

  // ==========================
  // LÓGICA DEL CARRITO
  // ==========================

  get totalArticulos(): number {
    return this.carrito.reduce((sum, item) => sum + item.cantidad, 0);
  }

  get totalPagar(): number {
    return this.carrito.reduce((sum, item) => sum + item.subtotal, 0);
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

      // 2. Procesar la venta en Supabase (RPC)
      const response = await this.posService.procesarVenta(this.carrito, this.totalPagar, metodoPago);

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

  limpiarCarrito() {
    this.carrito = [];
    this.buscarTexto = '';
    this.productosBusqueda = [];
  }

}
