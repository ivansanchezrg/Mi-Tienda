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
    if (tipo === 'DEUDA_CELULAR') return 'celular';
    if (tipo === 'SALDO_BAJO_BUS') return 'bus';
    if (tipo === 'STOCK_BAJO') return 'stock';
    return 'facturacion';
  }

  toggleStock() {
    this.stockExpandido = !this.stockExpandido;
  }

  async navegarProducto(producto: ProductoStockBajo) {
    await this.modalCtrl.dismiss({ reload: false });
    await this.router.navigate(['/inventario/kardex', producto.id], {
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
    const tab = notif.tipo === 'SALDO_BAJO_BUS' ? 'BUS' : 'CELULAR';
    await this.router.navigate(['/home/recargas-virtuales'], { queryParams: { tab } });
  }
}
