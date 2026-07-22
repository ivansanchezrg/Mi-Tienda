import { AfterViewInit, Component, ElementRef, inject, Input, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { addIcons } from 'ionicons';
import { IonIcon, IonSpinner, ModalController } from '@ionic/angular/standalone';
import { closeOutline, barcodeOutline, scanOutline, alertCircleOutline, layersOutline, pricetagOutline, cubeOutline } from 'ionicons/icons';
import { InventarioService } from 'src/app/features/inventario/services/inventario.service';
import { ProductoPOS, ProductoPresentacion } from 'src/app/features/inventario/models/producto.model';
import { StorageService } from '@core/services/storage.service';
import { CurrencyService } from '@core/services/currency.service';
import { UiService } from '@core/services/ui.service';
import { LoggerService } from '@core/services/logger.service';
import { BarcodeScannerService } from '@core/services/barcode-scanner.service';
import { ScannerOverlayComponent } from '@shared/components/scanner-overlay/scanner-overlay.component';

@Component({
  selector: 'app-consulta-precio-modal',
  templateUrl: './consulta-precio-modal.component.html',
  styleUrls: ['./consulta-precio-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonIcon, IonSpinner, ScannerOverlayComponent]
})
export class ConsultaPrecioModalComponent implements OnInit, AfterViewInit {
  private modalCtrl = inject(ModalController);
  private inventarioService = inject(InventarioService);
  private storageService = inject(StorageService);
  private currencyService = inject(CurrencyService);
  private ui = inject(UiService);
  private logger = inject(LoggerService);
  protected scanner = inject(BarcodeScannerService);

  /**
   * Código opcional pre-cargado (ej. si algún caller ya tiene uno). Ya NO define el modo
   * del modal: el input siempre está disponible (pistola HID / teclado) y la cámara es
   * un botón opcional dentro del input — mismo patrón que el catálogo del POS.
   */
  @Input() codigoInicial?: string;

  @ViewChild('codigoInput') codigoInputRef?: ElementRef<HTMLInputElement>;

  /** true mientras el escáner de cámara está activo (oculta el resto del modal). */
  escaneando = false;

  buscando = false;
  productoEncontrado: ProductoPOS | null = null;
  presentacionEncontrada: ProductoPresentacion | null = null;
  /** URL firmada lista para <img> — imagen_url de BD es un PATH de Storage, no una URL */
  imagenUrl: string | null = null;
  error: string | null = null;

  constructor() {
    addIcons({ closeOutline, barcodeOutline, scanOutline, alertCircleOutline, layersOutline, pricetagOutline, cubeOutline });
  }

  async ngOnInit() {
    if (this.codigoInicial) {
      await this.buscarProducto(this.codigoInicial);
    }
  }

  ngAfterViewInit() {
    // La pistola HID escribe donde esté el foco — enfocar apenas el modal se asienta.
    // Siempre: el input es la vía principal (pistola/teclado); la cámara es opcional.
    this.enfocarInput(150);
  }

  /** Enfoca el input tras un delay — la pistola HID necesita el foco para escribir. */
  private enfocarInput(delay = 0): void {
    setTimeout(() => this.codigoInputRef?.nativeElement?.focus(), delay);
  }

  /**
   * Abre la cámara del dispositivo para escanear un código (solo nativo). Al leer,
   * cierra la cámara y busca el producto en el mismo modal — el input sigue disponible
   * para el siguiente (pistola/teclado/cámara), flujo continuo como en el POS.
   */
  async escanearConCamara(): Promise<void> {
    if (!this.scanner.isAvailable || this.escaneando) return;

    this.escaneando = true;
    try {
      const codigo = await this.scanner.scan();
      if (codigo) await this.buscarProducto(codigo);
    } catch (err) {
      this.logger.error('ConsultaPrecioModal', 'Error al escanear con cámara', err);
    } finally {
      this.escaneando = false;
      // Devolver el foco al input para encadenar con la pistola sin tocar nada.
      this.enfocarInput(150);
    }
  }

  /** Cierra el escáner desde el overlay (botón ✕) — mismo patrón que inventario/POS. */
  async cerrarEscaner(): Promise<void> {
    await this.scanner.stop();
    this.escaneando = false;
  }

  async buscarManual(codigo: string) {
    const limpio = codigo.trim();
    if (!limpio || this.buscando) return;
    await this.buscarProducto(limpio);

    // Flujo en cadena (pistola): éxito → input limpio y enfocado para el siguiente
    // escaneo; no encontrado → texto seleccionado para que el siguiente lo pise.
    const el = this.codigoInputRef?.nativeElement;
    if (!el) return;
    if (this.productoEncontrado) {
      el.value = '';
    } else {
      el.select();
    }
    el.focus();
  }

  async buscarProducto(codigo: string) {
    this.buscando = true;
    this.error = null;
    this.productoEncontrado = null;
    this.presentacionEncontrada = null;
    this.imagenUrl = null;

    try {
      const resultado = await this.inventarioService.buscarPorCodigoBarras(codigo);

      if (resultado) {
        this.productoEncontrado = resultado.producto;
        this.presentacionEncontrada = resultado.presentacion ?? null;

        // Misma cadena de fallback que el POS: presentación → producto → template
        const path = resultado.presentacion?.imagen_url
                  || resultado.producto.imagen_url
                  || resultado.producto.producto_template?.imagen_url
                  || null;
        this.imagenUrl = path ? await this.storageService.resolveImageUrl(path) : null;
      } else {
        this.error = 'No se encontró ningún producto con ese código';
        await this.ui.showToast(this.error, 'danger');
      }
    } catch (err) {
      this.error = 'Error al consultar la base de datos';
      await this.ui.showToast(this.error, 'danger');
      this.logger.error('ConsultaPrecioModal', 'Error al buscar producto', err);
    } finally {
      this.buscando = false;
    }
  }

  formatearPrecio(precio: number): string {
    return this.currencyService.format(precio);
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }
}
