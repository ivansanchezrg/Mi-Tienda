import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { addIcons } from 'ionicons';
import { IonButton, IonIcon, IonSpinner, ModalController } from '@ionic/angular/standalone';
import { closeOutline, barcodeOutline, alertCircleOutline, layersOutline, pricetagOutline, cubeOutline } from 'ionicons/icons';
import { InventarioService } from 'src/app/features/inventario/services/inventario.service';
import { ProductoPOS, ProductoPresentacion } from 'src/app/features/inventario/models/producto.model';
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
export class ConsultaPrecioModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private inventarioService = inject(InventarioService);
  private currencyService = inject(CurrencyService);
  private ui = inject(UiService);
  private logger = inject(LoggerService);

  @Input() codigoInicial!: string;

  buscando = false;
  productoEncontrado: ProductoPOS | null = null;
  presentacionEncontrada: ProductoPresentacion | null = null;
  error: string | null = null;

  constructor() {
    addIcons({ closeOutline, barcodeOutline, alertCircleOutline, layersOutline, pricetagOutline, cubeOutline });
  }

  async ngOnInit() {
    await this.buscarProducto(this.codigoInicial);
  }

  async buscarProducto(codigo: string) {
    this.buscando = true;
    this.error = null;
    this.productoEncontrado = null;
    this.presentacionEncontrada = null;

    try {
      const resultado = await this.inventarioService.buscarPorCodigoBarras(codigo);

      if (resultado) {
        this.productoEncontrado = resultado.producto;
        this.presentacionEncontrada = resultado.presentacion ?? null;
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

  /** Cierra con role 'rescanear' — el layout reabre el escáner */
  consultarOtro() {
    this.modalCtrl.dismiss(null, 'rescanear');
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }
}
