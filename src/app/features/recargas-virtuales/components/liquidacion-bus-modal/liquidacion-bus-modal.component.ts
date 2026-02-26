import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, checkmarkCircleOutline, cashOutline,
  busOutline, informationCircleOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { RecargasVirtualesService } from '@core/services/recargas-virtuales.service';
import { CajasService } from '../../../dashboard/services/cajas.service';
import { AuthService } from '../../../auth/services/auth.service';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { NumbersOnlyDirective } from '@shared/directives/numbers-only.directive';

@Component({
  selector: 'app-liquidacion-bus-modal',
  templateUrl: './liquidacion-bus-modal.component.html',
  styleUrls: ['./liquidacion-bus-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon,
    CurrencyInputDirective,
    NumbersOnlyDirective
  ]
})
export class LiquidacionBusModalComponent implements OnInit {
  /** Ganancia Bus calculada del mes anterior (SUM recargas_virtuales.ganancia) */
  @Input() gananciaBusCalculada = 0;
  /** Mes anterior en formato legible, ej: "Enero 2026" */
  @Input() mesDisplay = '';
  /** Mes anterior en formato YYYY-MM para descripción de la transferencia */
  @Input() mesAnterior = '';

  private modalCtrl = inject(ModalController);
  private ui = inject(UiService);
  private recargasService = inject(RecargasVirtualesService);
  private cajasService = inject(CajasService);
  private authService = inject(AuthService);

  /** Monto acreditado por el proveedor como saldo virtual BUS */
  montoAcreditado: number | null = null;

  constructor() {
    addIcons({
      closeOutline, checkmarkCircleOutline, cashOutline,
      busOutline, informationCircleOutline
    });
  }

  async ngOnInit() {}

  get puedeConfirmar(): boolean {
    return !!this.montoAcreditado && this.montoAcreditado > 0;
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }

  async confirmar() {
    if (!this.puedeConfirmar || !this.montoAcreditado) {
      await this.ui.showError('Ingresá el monto acreditado por el proveedor');
      return;
    }

    await this.ui.showLoading('Registrando liquidación...');

    try {
      const empleado = await this.authService.getEmpleadoActual();
      if (!empleado) {
        throw new Error('No se pudo obtener el empleado actual');
      }

      // 1. Registrar el saldo virtual recibido del proveedor como nueva compra BUS
      const resultadoCompra = await this.recargasService.registrarCompraSaldoBus({
        fecha: this.recargasService.getFechaLocal(),
        empleado_id: empleado.id,
        monto: this.montoAcreditado,
        notas: `Liquidación ganancia proveedor ${this.mesDisplay}`
      });

      if (!resultadoCompra) {
        throw new Error('Error al registrar el saldo virtual recibido');
      }

      // 2. Transferir la ganancia calculada de CAJA_BUS a CAJA_CHICA
      await this.cajasService.crearTransferencia({
        cajaOrigenId: 4,  // CAJA_BUS
        cajaDestinoId: 2, // CAJA_CHICA
        monto: this.gananciaBusCalculada,
        empleadoId: empleado.id,
        descripcion: `Ganancia 1% ${this.mesAnterior}`
      });

      await this.ui.hideLoading();
      await this.ui.showSuccess(
        `Liquidación registrada. Saldo virtual +$${this.montoAcreditado.toFixed(2)}. Ganancia $${this.gananciaBusCalculada.toFixed(2)} transferida a Caja Chica.`
      );

      this.modalCtrl.dismiss({ success: true });
    } catch (error: any) {
      await this.ui.hideLoading();
      await this.ui.showError(error?.message || 'Error al registrar la liquidación');
    }
  }
}

