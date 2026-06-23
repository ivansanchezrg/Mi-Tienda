import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, phonePortraitOutline, busOutline, calendarOutline,
  notificationsOffOutline, chevronForwardOutline, cubeOutline, chevronDownOutline
} from 'ionicons/icons';
import { Notificacion, ProductoStockBajo } from '@core/services/notificaciones.service';
import { ROUTES } from '@core/config/routes.config';

@Component({
  selector: 'app-notificaciones-modal',
  templateUrl: './notificaciones-modal.component.html',
  styleUrls: ['./notificaciones-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon
  ]
})
export class NotificacionesModalComponent {
  private modalCtrl = inject(ModalController);
  private router = inject(Router);

  notificaciones: Notificacion[] = [];
  stockExpandido = false;

  constructor() {
    addIcons({
      closeOutline, phonePortraitOutline, busOutline, calendarOutline,
      notificationsOffOutline, chevronForwardOutline, cubeOutline, chevronDownOutline
    });
  }

  getIconClass(tipo: string): string {
    if (tipo === 'SALDO_BAJO_BUS') return 'bus';
    if (tipo === 'STOCK_BAJO') return 'stock';
    return 'facturacion';
  }

  toggleStock() {
    this.stockExpandido = !this.stockExpandido;
  }

  async navegarProducto(producto: ProductoStockBajo) {
    await this.modalCtrl.dismiss({ reload: false });
    await this.router.navigate([ROUTES.inventario.kardex(producto.id)], {
      queryParams: { nombre: producto.nombre, stock: producto.stock_actual }
    });
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }

  async navegar(notif: Notificacion) {
    if (notif.tipo === 'STOCK_BAJO') {
      if (notif.productos?.length === 1) {
        await this.navegarProducto(notif.productos[0]);
      } else {
        this.toggleStock();
      }
      return;
    }
    await this.modalCtrl.dismiss({ reload: false });
    // Todas las notificaciones de este bloque son de BUS (saldo bajo, ganancia
    // pendiente de liquidar, recordatorio de fin de mes) — nunca de CELULAR.
    // Antes el default caía en 'CELULAR' para cualquier tipo que no fuera
    // SALDO_BAJO_BUS, mandando a la tab equivocada para FACTURACION_BUS_*.
    await this.router.navigate([ROUTES.recargasVirtuales], { queryParams: { tab: 'BUS' } });
  }
}
