import { AfterViewInit, Component, ElementRef, inject, Input, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { addIcons } from 'ionicons';
import { IonButton, IonIcon, IonSpinner, ModalController } from '@ionic/angular/standalone';
import { closeOutline, barcodeOutline, alertCircleOutline, layersOutline, pricetagOutline, cubeOutline } from 'ionicons/icons';
import { InventarioService } from 'src/app/features/inventario/services/inventario.service';
import { ProductoPOS, ProductoPresentacion } from 'src/app/features/inventario/models/producto.model';
import { StorageService } from '@core/services/storage.service';
import { CurrencyService } from '@core/services/currency.service';
import { UiService } from '@core/services/ui.service';
import { LoggerService } from '@core/services/logger.service';

@Component({
  selector: 'app-consulta-precio-modal',
  templateUrl: './consulta-precio-modal.component.html',
  styleUrls: ['./consulta-precio-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonButton, IonIcon, IonSpinner]
})
export class ConsultaPrecioModalComponent implements OnInit, AfterViewInit {
  private modalCtrl = inject(ModalController);
  private inventarioService = inject(InventarioService);
  private storageService = inject(StorageService);
  private currencyService = inject(CurrencyService);
  private ui = inject(UiService);
  private logger = inject(LoggerService);

  /** Código ya escaneado (cámara nativa). Sin él → modo manual (pistola HID / teclado). */
  @Input() codigoInicial?: string;

  @ViewChild('codigoInput') codigoInputRef?: ElementRef<HTMLInputElement>;

  buscando = false;
  productoEncontrado: ProductoPOS | null = null;
  presentacionEncontrada: ProductoPresentacion | null = null;
  /** URL firmada lista para <img> — imagen_url de BD es un PATH de Storage, no una URL */
  imagenUrl: string | null = null;
  error: string | null = null;

  /** Web/desktop: la pistola de escaneo actúa como teclado — escribe en el input + Enter */
  get modoManual(): boolean {
    return !this.codigoInicial;
  }

  constructor() {
    addIcons({ closeOutline, barcodeOutline, alertCircleOutline, layersOutline, pricetagOutline, cubeOutline });
  }

  async ngOnInit() {
    if (this.codigoInicial) {
      await this.buscarProducto(this.codigoInicial);
    }
  }

  ngAfterViewInit() {
    // La pistola HID escribe donde esté el foco — enfocar apenas el modal se asienta
    if (this.modoManual) {
      setTimeout(() => this.codigoInputRef?.nativeElement?.focus(), 150);
    }
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

  /** Solo modo cámara: cierra con role 'rescanear' y el layout reabre el escáner.
   *  En modo manual no hay botón — el input siempre visible ES la acción. */
  consultarOtro() {
    this.modalCtrl.dismiss(null, 'rescanear');
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }
}
