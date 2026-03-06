import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addOutline,
  searchOutline,
  barcodeOutline,
  alertCircleOutline,
  cubeOutline
} from 'ionicons/icons';
import { InventarioService } from '../../services/inventario.service';
import { Producto } from '../../models/producto.model';
import { CategoriaProducto } from '../../models/categoria-producto.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { ProductoModalComponent } from '../../components/producto-modal/producto-modal.component';

@Component({
  selector: 'app-inventario',
  templateUrl: './inventario.page.html',
  styleUrls: ['./inventario.page.scss'],
  standalone: true,
  imports: [IonicModule, CommonModule, FormsModule]
})
export class InventarioPage implements OnInit {
  private inventarioService = inject(InventarioService);
  public currencyService = inject(CurrencyService);
  private modalCtrl = inject(ModalController);

  productos: Producto[] = [];
  categorias: CategoriaProducto[] = [];

  cargando = true;
  buscarTexto = '';
  categoriaSeleccionada?: number;

  constructor() {
    addIcons({
      addOutline,
      searchOutline,
      barcodeOutline,
      alertCircleOutline,
      cubeOutline
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

  async abrirModalCrear() {
    const modal = await this.modalCtrl.create({
      component: ProductoModalComponent,
      componentProps: { categorias: this.categorias },
      cssClass: 'modal-fullscreen-mobile'
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
      },
      cssClass: 'modal-fullscreen-mobile' // Opción en caso de que quieran full screen
    });

    await modal.present();
    const { data } = await modal.onDidDismiss<Producto>();

    if (data) {
      this.cargarDatos();
    }
  }
}

