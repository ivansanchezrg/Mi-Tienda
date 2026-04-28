import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, cashOutline, checkmarkCircleOutline,
  alertCircleOutline, arrowForwardOutline
} from 'ionicons/icons';
import { MovimientosEmpleadosService } from '../../services/movimientos-empleados.service';
import { AuthService } from '../../../auth/services/auth.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { InstruccionFisica } from '../../models/movimiento-empleado.model';

@Component({
  selector: 'app-adelanto-modal',
  templateUrl: './adelanto-modal.component.html',
  styleUrls: ['./adelanto-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonButton, IonIcon]
})
export class AdelantoModalComponent {

  @Input() empleadoId!: string;
  @Input() empleadoNombre = '';

  private modalCtrl = inject(ModalController);
  private service = inject(MovimientosEmpleadosService);
  private authService = inject(AuthService);
  public currency = inject(CurrencyService);

  montoRaw: number | null = null;
  descripcion = '';
  guardando = false;
  errorMsg = '';

  // Post-confirmacion
  exito = false;
  instrucciones: InstruccionFisica[] = [];
  montoFinal = 0;

  constructor() {
    addIcons({ closeOutline, cashOutline, checkmarkCircleOutline, alertCircleOutline, arrowForwardOutline });
  }

  get montoNumerico(): number {
    return this.montoRaw && this.montoRaw > 0 ? this.montoRaw : 0;
  }

  get valido(): boolean {
    return this.montoNumerico > 0;
  }

  async confirmar() {
    if (!this.valido || this.guardando) return;
    this.guardando = true;
    this.errorMsg = '';

    try {
      const usuario = await this.authService.getUsuarioActual();
      if (!usuario) return;

      const res = await this.service.registrarAdelanto({
        empleadoId: usuario.id,
        beneficiarioId: this.empleadoId,
        monto: this.montoNumerico,
        descripcion: this.descripcion.trim() || undefined
      });

      if (res.success) {
        this.montoFinal = this.montoNumerico;
        this.instrucciones = res.instrucciones_fisicas ?? [];
        this.exito = true;
      } else {
        this.errorMsg = res.error ?? 'Error desconocido';
      }
    } finally {
      this.guardando = false;
    }
  }

  cerrar() {
    this.modalCtrl.dismiss(this.exito ? { registrado: true } : undefined);
  }
}
