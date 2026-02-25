import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonCard
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, checkmarkCircleOutline, alertCircleOutline,
  phonePortraitOutline, busOutline
} from 'ionicons/icons';
import { ModalController } from '@ionic/angular/standalone';
import { UiService } from '@core/services/ui.service';
import { RecargasVirtualesService, RecargaVirtual } from '../../services/recargas-virtuales.service';

type TipoServicio = 'CELULAR' | 'BUS';

@Component({
  selector: 'app-historial-modal',
  templateUrl: './historial-modal.component.html',
  styleUrls: ['./historial-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonCard
  ]
})
export class HistorialModalComponent implements OnInit {
  @Input() tipo: TipoServicio = 'CELULAR';

  private modalCtrl = inject(ModalController);
  private ui = inject(UiService);
  private service = inject(RecargasVirtualesService);

  loading = true;
  historial: RecargaVirtual[] = [];

  constructor() {
    addIcons({
      closeOutline,
      checkmarkCircleOutline,
      alertCircleOutline,
      phonePortraitOutline,
      busOutline
    });
  }

  async ngOnInit() {
    await this.cargarHistorial();
  }

  async cargarHistorial() {
    this.loading = true;
    try {
      this.historial = await this.service.obtenerHistorial(this.tipo);
    } catch {
      await this.ui.showError('Error al cargar el historial');
    } finally {
      this.loading = false;
    }
  }

  get tituloModal(): string {
    return `Historial ${this.tipo === 'CELULAR' ? 'Celular' : 'Bus'}`;
  }

  get iconoServicio(): string {
    return this.tipo === 'CELULAR' ? 'phone-portrait-outline' : 'bus-outline';
  }

  formatearFecha(fecha: string): string {
    const d = new Date(fecha + 'T00:00:00');
    return d.toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }
}
