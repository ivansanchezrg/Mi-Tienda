import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, ModalController, AlertController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, addCircleOutline,
  phonePortraitOutline, busOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { RecargasVirtualesService } from '../../services/recargas-virtuales.service';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { NumbersOnlyDirective } from '@shared/directives/numbers-only.directive';

type TipoServicio = 'CELULAR' | 'BUS';

@Component({
  selector: 'app-registrar-recarga-modal',
  templateUrl: './registrar-recarga-modal.component.html',
  styleUrls: ['./registrar-recarga-modal.component.scss'],
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
export class RegistrarRecargaModalComponent implements OnInit {
  @Input() tipo: TipoServicio = 'CELULAR';

  private modalCtrl = inject(ModalController);
  private alertCtrl = inject(AlertController);
  private ui = inject(UiService);
  private service = inject(RecargasVirtualesService);

  montoVirtual: number | null = null;
  comisionPct: number = 5; // valor por defecto, se reemplaza con el de BD al abrir

  constructor() {
    addIcons({
      closeOutline,
      addCircleOutline,
      phonePortraitOutline,
      busOutline
    });
  }

  async ngOnInit() {
    if (this.tipo === 'CELULAR') {
      this.comisionPct = await this.service.getPorcentajeComision('CELULAR');
    }
  }

  get tituloModal(): string {
    return this.tipo === 'CELULAR' ? 'Recarga del Proveedor - Celular' : 'Comprar Saldo - Bus';
  }

  get labelMonto(): string {
    return this.tipo === 'CELULAR' ? 'Monto virtual cargado' : 'Monto a comprar';
  }

  get iconoServicio(): string {
    return this.tipo === 'CELULAR' ? 'phone-portrait-outline' : 'bus-outline';
  }

  // Cálculos para CELULAR (usa porcentaje dinámico desde BD)
  get montoAPagar(): number {
    if (!this.montoVirtual || this.montoVirtual <= 0) return 0;
    return Math.round((this.montoVirtual * (1 - this.comisionPct / 100)) * 100) / 100;
  }

  get ganancia(): number {
    if (!this.montoVirtual || this.montoVirtual <= 0) return 0;
    return Math.round((this.montoVirtual - this.montoAPagar) * 100) / 100;
  }

  get mostrarCalculos(): boolean {
    return this.tipo === 'CELULAR' && !!this.montoVirtual && this.montoVirtual > 0;
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }

  /**
   * Muestra un alert pidiendo confirmación de que el empleado ya movió físicamente
   * la ganancia de Caja Celular a Caja Chica.
   * @returns true si confirmó, false si canceló
   */
  private async pedirConfirmacionMovimientoFisico(): Promise<boolean> {
    return new Promise(async (resolve) => {
      const alert = await this.alertCtrl.create({
        header: 'Mover efectivo físicamente',
        message: `¿Ya tomaste $${this.ganancia.toFixed(2)} de Caja Celular y lo llevaste a Caja Chica?`,
        buttons: [
          {
            text: 'Cancelar',
            role: 'cancel',
            handler: () => resolve(false)
          },
          {
            text: 'Sí, ya lo hice',
            handler: () => resolve(true)
          }
        ]
      });
      await alert.present();
    });
  }

  async confirmar() {
    if (!this.montoVirtual || this.montoVirtual <= 0) {
      await this.ui.showError('Ingresá el monto');
      return;
    }

    // Para CELULAR: confirmar que el empleado ya movió el efectivo físicamente
    if (this.tipo === 'CELULAR' && this.ganancia > 0) {
      const confirmado = await this.pedirConfirmacionMovimientoFisico();
      if (!confirmado) return;
    }

    const empleado = await this.service.obtenerEmpleadoActual();
    if (!empleado) {
      await this.ui.showError('No se pudo obtener el empleado');
      return;
    }

    let resultado;

    if (this.tipo === 'CELULAR') {
      // UNA SOLA LLAMADA - TODO EN TRANSACCIÓN (v1.0)
      resultado = await this.service.registrarRecargaProveedorCelularCompleto({
        fecha: this.service.getFechaLocal(),
        empleado_id: empleado.id,
        monto_virtual: this.montoVirtual
      });

      if (!resultado?.success) {
        await this.ui.showError('Error al registrar recarga');
        return;
      }

      // Mensaje enriquecido con datos del resultado
      await this.ui.showSuccess(
        `Recarga registrada: $${resultado.monto_virtual.toFixed(2)}\n` +
        `Deuda pendiente: $${resultado.monto_a_pagar.toFixed(2)}\n` +
        `Ganancia $${resultado.ganancia.toFixed(2)} transferida a Caja Chica ✓\n` +
        `Saldo Virtual Celular: $${resultado.saldos_actualizados.saldo_virtual_celular.toFixed(2)}`
      );

      // Cerrar modal con TODOS los datos actualizados
      this.modalCtrl.dismiss({
        success: true,
        data: resultado  // Pasar resultado completo
      });
    } else {
      // BUS mantiene su flujo original (ya tiene EGRESO inmediato en su función)
      resultado = await this.service.registrarCompraSaldoBus({
        fecha: this.service.getFechaLocal(),
        empleado_id: empleado.id,
        monto: this.montoVirtual
      });

      if (!resultado) return;

      await this.ui.showSuccess(`Compra registrada: $${this.montoVirtual.toFixed(2)}`);

      // Cerrar modal con éxito
      this.modalCtrl.dismiss({ success: true });
    }
  }
}
