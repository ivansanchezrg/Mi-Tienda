import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, addCircleOutline,
  phonePortraitOutline, busOutline,
  checkmarkCircleOutline, alertCircleOutline
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
  private ui = inject(UiService);
  private service = inject(RecargasVirtualesService);

  montoVirtual: number | null = null;
  comisionPct: number = 5;  // valor por defecto, se reemplaza con el de BD al abrir
  saldoCajaBus: number = 0; // solo usado cuando tipo === 'BUS'

  constructor() {
    addIcons({
      closeOutline,
      addCircleOutline,
      phonePortraitOutline,
      busOutline,
      checkmarkCircleOutline,
      alertCircleOutline
    });
  }

  async ngOnInit() {
    if (this.tipo === 'CELULAR') {
      this.comisionPct = await this.service.getPorcentajeComision('CELULAR');
    } else {
      this.saldoCajaBus = await this.service.getSaldoCajaActual('CAJA_BUS');
    }
  }

  get saldoBusInsuficiente(): boolean {
    if (this.tipo !== 'BUS' || !this.montoVirtual || this.montoVirtual <= 0) return false;
    return this.montoVirtual > this.saldoCajaBus;
  }

  get saldoBusDespues(): number {
    return this.saldoCajaBus - (this.montoVirtual ?? 0);
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

  async confirmar() {
    if (!this.montoVirtual || this.montoVirtual <= 0) {
      await this.ui.showError('Ingresá el monto');
      return;
    }

    const empleado = await this.service.obtenerEmpleadoActual();
    if (!empleado) {
      await this.ui.showError('No se pudo obtener el empleado');
      return;
    }

    let resultado;

    if (this.tipo === 'CELULAR') {
      // UNA SOLA LLAMADA - TODO EN TRANSACCIÓN (v2.0 - solo crea la deuda)
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
        `Ganancia: $${resultado.ganancia.toFixed(2)}\n` +
        `Saldo Virtual Celular: $${resultado.saldo_virtual_celular.toFixed(2)}`
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
