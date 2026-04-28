import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, warningOutline, cashOutline } from 'ionicons/icons';
import { TurnosCajaService } from '../../services/turnos-caja.service';
import { UiService } from '@core/services/ui.service';
import { CurrencyService } from '@core/services/currency.service';

@Component({
  selector: 'app-cierre-emergencia-modal',
  templateUrl: './cierre-emergencia-modal.component.html',
  styleUrls: ['./cierre-emergencia-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonButton,
    IonIcon,
  ]
})
export class CierreEmergenciaModalComponent {
  private modalCtrl = inject(ModalController);
  private turnosCajaService = inject(TurnosCajaService);
  private ui = inject(UiService);
  private currencyService = inject(CurrencyService);

  /** UUID del turno a cerrar */
  @Input() turnoId!: string;
  /** UUID del admin que autoriza el cierre */
  @Input() adminId!: string;
  /** Nombre del empleado ausente (para mostrar en el modal) */
  @Input() empleadoNombre!: string;
  /** Hora de apertura del turno (para mostrar en el modal) */
  @Input() horaApertura!: string;

  efectivoFisicoRaw = '';
  motivo = '';
  guardando = false;
  errorMsg = '';

  constructor() {
    addIcons({ closeOutline, warningOutline, cashOutline });
  }

  get efectivoFisico(): number {
    return this.currencyService.parse(this.efectivoFisicoRaw);
  }

  get efectivoValido(): boolean {
    return this.efectivoFisicoRaw.trim().length > 0 && this.efectivoFisico >= 0;
  }

  get puedeCerrar(): boolean {
    return this.efectivoValido && !this.guardando;
  }

  onEfectivoBlur() {
    if (this.efectivoFisicoRaw.trim()) {
      const parsed = this.currencyService.parse(this.efectivoFisicoRaw);
      this.efectivoFisicoRaw = this.currencyService.format(parsed);
    }
  }

  onEfectivoFocus() {
    if (this.efectivoFisicoRaw.trim()) {
      const parsed = this.currencyService.parse(this.efectivoFisicoRaw);
      this.efectivoFisicoRaw = parsed > 0 ? parsed.toFixed(2) : '';
    }
  }

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async confirmar() {
    if (!this.puedeCerrar) return;

    this.guardando = true;
    this.errorMsg = '';

    const resultado = await this.turnosCajaService.cerrarEmergencia({
      adminId:        this.adminId,
      turnoId:        this.turnoId,
      efectivoFisico: this.efectivoFisico,
      motivo:         this.motivo.trim() || undefined
    });

    this.guardando = false;

    if (!resultado?.success) {
      this.errorMsg = 'No se pudo ejecutar el cierre. Verifica tu conexion e intenta de nuevo.';
      return;
    }

    this.modalCtrl.dismiss({ resultado }, 'confirm');
  }
}
