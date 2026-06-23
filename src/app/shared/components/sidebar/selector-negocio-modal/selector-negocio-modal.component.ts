import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalController } from '@ionic/angular/standalone';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkCircle, addCircleOutline, closeOutline } from 'ionicons/icons';
import { NegocioDisponible } from '../../../../features/auth/services/auth.service';
import { NegocioService } from '../../../../features/auth/services/negocio.service';
import { UiService } from '@core/services/ui.service';

@Component({
  selector: 'app-selector-negocio-modal',
  templateUrl: './selector-negocio-modal.component.html',
  styleUrls: ['./selector-negocio-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonIcon]
})
export class SelectorNegocioModalComponent implements OnInit {
  private modalCtrl     = inject(ModalController);
  private negocioService = inject(NegocioService);
  private ui            = inject(UiService);

  /** Negocio actualmente activo (para marcar el checkmark) */
  @Input() negocioActivoId = '';

  negocios: NegocioDisponible[] = [];
  loading = false;

  constructor() {
    addIcons({ checkmarkCircle, addCircleOutline, closeOutline });
  }

  async ngOnInit() {
    this.loading = true;
    try {
      this.negocios = await this.negocioService.getMisNegocios();
    } finally {
      this.loading = false;
    }
  }

  seleccionar(negocio: NegocioDisponible) {
    if (negocio.negocio_id === this.negocioActivoId) {
      this.cerrar();
      return;
    }
    this.modalCtrl.dismiss(negocio, 'seleccionar');
  }

  abrirCrearSucursal() {
    this.modalCtrl.dismiss(null, 'crear');
  }

  cerrar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  rolLegible(rol: string): string {
    return rol === 'ADMIN' ? 'Admin' : 'Empleado';
  }
}
