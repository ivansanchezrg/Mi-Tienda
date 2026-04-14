import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonInput,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, cashOutline, checkmarkCircleOutline } from 'ionicons/icons';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { MovimientosEmpleadosService } from '../../services/movimientos-empleados.service';
import { AuthService } from '../../../auth/services/auth.service';
import { UiService } from '../../../../core/services/ui.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { InstruccionFisica } from '../../models/movimiento-empleado.model';

@Component({
  selector: 'app-adelanto-modal',
  templateUrl: './adelanto-modal.component.html',
  styleUrls: ['./adelanto-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonInput,
    CurrencyInputDirective
  ]
})
export class AdelantoModalComponent {

  @Input() empleadoId!: number;
  @Input() empleadoNombre = '';

  private modalCtrl = inject(ModalController);
  private service = inject(MovimientosEmpleadosService);
  private authService = inject(AuthService);
  private ui = inject(UiService);
  public currencyService = inject(CurrencyService);

  monto = '';
  descripcion = '';
  guardando = false;

  // Resultado post-confirmacion
  resultado: 'pendiente' | 'exito' | 'error' = 'pendiente';
  instrucciones: InstruccionFisica[] = [];
  mensajeError = '';

  constructor() {
    addIcons({ closeOutline, cashOutline, checkmarkCircleOutline });
  }

  get montoNumerico(): number {
    return this.currencyService.parse(this.monto);
  }

  get valido(): boolean {
    return this.montoNumerico > 0;
  }

  async confirmar() {
    if (!this.valido || this.guardando) return;
    this.guardando = true;

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
        this.instrucciones = res.instrucciones_fisicas ?? [];
        this.resultado = 'exito';
      } else {
        this.mensajeError = res.error ?? 'Error desconocido';
        this.resultado = 'error';
      }
    } finally {
      this.guardando = false;
    }
  }

  cerrar() {
    this.modalCtrl.dismiss(
      this.resultado === 'exito' ? { registrado: true } : undefined
    );
  }
}
