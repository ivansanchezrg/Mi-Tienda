import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonButton, IonIcon, IonCheckbox,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, alertCircleOutline, checkmarkCircle, checkmarkCircleOutline,
  checkmarkOutline, fileTrayOutline, lockOpenOutline
} from 'ionicons/icons';
import { TurnosCajaService } from '../../services/turnos-caja.service';
import { UiService } from '@core/services/ui.service';

@Component({
  selector: 'app-verificar-fondo-modal',
  templateUrl: './verificar-fondo-modal.component.html',
  styleUrls: ['./verificar-fondo-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonButton, IonIcon, IonCheckbox
  ]
})
export class VerificarFondoModalComponent {
  private modalCtrl = inject(ModalController);
  private turnosCajaService = inject(TurnosCajaService);
  private ui = inject(UiService);

  // Props recibidas via componentProps desde home.page
  fondoFijo = 0;
  deficitVarios = 0;
  fondoFaltante = 0;

  // Estado interno
  pasoActual: 1 | 2 = 1;
  confirmado = false;
  errorMsg = '';
  abriendo = false;

  constructor() {
    addIcons({
      closeOutline, alertCircleOutline, checkmarkCircle, checkmarkCircleOutline,
      checkmarkOutline, fileTrayOutline, lockOpenOutline
    });
  }

  get hayDeficit(): boolean {
    return this.deficitVarios > 0 || this.fondoFaltante > 0;
  }

  get totalAReponer(): number {
    return this.deficitVarios + this.fondoFaltante;
  }

  avanzarPaso2(): void {
    this.pasoActual = 2;
  }

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async abrirCaja(): Promise<void> {
    if (this.abriendo) return;

    if (!this.hayDeficit) {
      this.modalCtrl.dismiss({ confirmado: true }, 'confirm');
      return;
    }

    this.abriendo = true;
    this.errorMsg = '';
    await this.ui.showLoading('Abriendo caja...');

    const result = await this.turnosCajaService.repararDeficit(
      this.deficitVarios,
      this.fondoFaltante
    );

    await this.ui.hideLoading();

    if (!result.ok) {
      this.abriendo = false;
      await this.ui.showError(result.errorMsg || 'Error al registrar. Verifica tu conexión e intenta de nuevo.');
      return;
    }

    this.modalCtrl.dismiss({ confirmado: true, turnoId: result.turnoId }, 'confirm');
  }
}
