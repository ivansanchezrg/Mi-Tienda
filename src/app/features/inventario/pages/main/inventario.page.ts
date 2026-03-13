import { Component, inject, NgZone, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addOutline,
  searchOutline,
  barcodeOutline,
  alertCircleOutline,
  cubeOutline,
  scanOutline,
  closeOutline
} from 'ionicons/icons';
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { InventarioService } from '../../services/inventario.service';
import { Producto } from '../../models/producto.model';
import { CategoriaProducto } from '../../models/categoria-producto.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { ProductoModalComponent } from '../../components/producto-modal/producto-modal.component';

@Component({
  selector: 'app-inventario',
  templateUrl: './inventario.page.html',
  styleUrls: ['./inventario.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule]
})
export class InventarioPage implements OnInit, OnDestroy {
  private inventarioService = inject(InventarioService);
  public currencyService = inject(CurrencyService);
  private modalCtrl = inject(ModalController);
  private ui = inject(UiService);
  private ngZone = inject(NgZone);

  productos: Producto[] = [];
  categorias: CategoriaProducto[] = [];

  cargando = true;
  buscarTexto = '';
  categoriaSeleccionada?: number;
  escaneando = false;

  private audioCtx: AudioContext | null = null;

  constructor() {
    addIcons({
      addOutline,
      searchOutline,
      barcodeOutline,
      alertCircleOutline,
      cubeOutline,
      scanOutline,
      closeOutline
    });
  }

  ngOnInit() {
    this.cargarDatos();
  }


  async cargarDatos(event?: any) {
    if (!event) this.cargando = true;
    try {
      if (this.categorias.length === 0) {
        this.categorias = await this.inventarioService.obtenerCategorias();
      }

      this.productos = await this.inventarioService.obtenerProductos(
        this.buscarTexto,
        this.categoriaSeleccionada === 0 ? undefined : this.categoriaSeleccionada
      );
    } catch (e) {
      console.error(e);
    } finally {
      this.cargando = false;
      if (event) event.target.complete();
    }
  }

  aplicarFiltro() {
    this.cargando = true;
    this.cargarDatos();
  }

  async abrirModalCrear(codigoBarras?: string) {
    const modal = await this.modalCtrl.create({
      component: ProductoModalComponent,
      componentProps: {
        categorias: this.categorias,
        ...(codigoBarras && { codigoBarrasInicial: codigoBarras })
      }
    });

    await modal.present();
    const { data } = await modal.onDidDismiss<Producto>();

    if (data) {
      this.cargarDatos();
    }
  }

  async abrirModalEditar(producto: Producto) {
    const modal = await this.modalCtrl.create({
      component: ProductoModalComponent,
      componentProps: {
        producto: producto,
        categorias: this.categorias
      }
    });

    await modal.present();
    const { data } = await modal.onDidDismiss<Producto>();

    if (data) {
      this.cargarDatos();
    }
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
          // Feedback
          navigator.vibrate?.(40);
          this.playBeep();
          // Cerrar escáner y abrir modal con código precargado
          await this.cerrarEscaner();
          this.abrirModalCrear(codigo);
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
    this.audioCtx?.close().catch(() => {});
  }
}

