import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonSkeletonText, IonSpinner, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, arrowDownOutline, arrowUpOutline, createOutline,
  cashOutline, imageOutline, documentTextOutline
} from 'ionicons/icons';
import { OperacionesCajaService } from '../../services/operaciones-caja.service';
import { StorageService } from '@core/services/storage.service';
import { OperacionCaja } from '../../models/operacion-caja.model';
import { OperacionLabelPipe } from '../../../../shared/pipes/operacion-label.pipe';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';

@Component({
  selector: 'app-movimientos-hoy-modal',
  templateUrl: './movimientos-hoy-modal.component.html',
  styleUrls: ['./movimientos-hoy-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonIcon, IonSkeletonText, IonSpinner,
    EmptyStateComponent,
    OperacionLabelPipe
  ]
})
export class MovimientosHoyModalComponent implements OnInit {
  private modalCtrl          = inject(ModalController);
  private operacionesService = inject(OperacionesCajaService);
  private storageService     = inject(StorageService);

  totalMovimientosHoy = 0;

  movimientos: OperacionCaja[] = [];
  loading = true;
  cargandoMas = false;
  hasMore = false;
  cargandoComprobante = new Set<string>();
  private page = 0;

  constructor() {
    addIcons({
      closeOutline, arrowDownOutline, arrowUpOutline, createOutline,
      cashOutline, imageOutline, documentTextOutline
    });
  }

  async ngOnInit() {
    await this.cargar(true);
  }

  private async cargar(reset = false) {
    if (reset) {
      this.page = 0;
      this.movimientos = [];
      this.loading = true;
    } else {
      this.cargandoMas = true;
    }
    try {
      const result = await this.operacionesService.obtenerMovimientosHoy(this.page);
      this.movimientos = reset
        ? result.operaciones
        : [...this.movimientos, ...result.operaciones];
      this.hasMore = result.hasMore;
    } finally {
      this.loading    = false;
      this.cargandoMas = false;
    }
  }

  async cargarMas() {
    if (this.cargandoMas || !this.hasMore) return;
    this.page++;
    await this.cargar();
  }

  async onVerComprobante(mov: OperacionCaja) {
    if (!mov.comprobante_url || this.cargandoComprobante.has(mov.id)) return;
    this.cargandoComprobante.add(mov.id);
    try {
      const url = await this.storageService.resolveImageUrl(mov.comprobante_url);
      if (url) window.open(url, '_blank');
    } finally {
      this.cargandoComprobante.delete(mov.id);
    }
  }

  formatHora(fecha: string): string {
    return new Date(fecha).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }
}
