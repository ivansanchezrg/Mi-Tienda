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

  // CELULAR
  montoVirtual: number | null = null;
  comisionPct: number = 5;

  // BUS
  saldoCajaBus: number = 0;
  saldoVirtualSistemaBus: number = 0; // último cierre + recargas post-cierre
  saldoVirtualMaquina: number | null = null; // lo que muestra la máquina ahora

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
    try {
      if (this.tipo === 'CELULAR') {
        this.comisionPct = await this.service.getPorcentajeComision('CELULAR');
      } else {
        const [saldoCaja, saldoVirtual] = await Promise.all([
          this.service.getSaldoCajaActual('CAJA_BUS'),
          this.service.getSaldoVirtualActual('BUS')
        ]);
        this.saldoCajaBus = saldoCaja;
        this.saldoVirtualSistemaBus = saldoVirtual;
      }
    } catch {
      await this.ui.showError('Error al cargar los datos');
    }
  }

  // ──────────────────────────────
  // Getters BUS
  // ──────────────────────────────

  /**
   * Ventas del día = saldo que el sistema espera − saldo que la máquina muestra.
   * Solo se calcula cuando el usuario ingresó el saldo de la máquina.
   */
  get ventaBusCalculada(): number {
    if (this.saldoVirtualMaquina === null || this.saldoVirtualMaquina < 0) return 0;
    return Math.max(0, this.saldoVirtualSistemaBus - this.saldoVirtualMaquina);
  }

  /**
   * Total físico disponible para depositar:
   *   saldo acumulado en CAJA_BUS + ventas de hoy (aún no en CAJA_BUS)
   */
  get disponibleParaDepositar(): number {
    return this.saldoCajaBus + this.ventaBusCalculada;
  }

  /** true cuando el usuario ya ingresó el saldo de la máquina */
  get maquinaIngresada(): boolean {
    return this.saldoVirtualMaquina !== null && this.saldoVirtualMaquina >= 0;
  }

  get saldoBusInsuficiente(): boolean {
    if (this.tipo !== 'BUS' || !this.montoVirtual || this.montoVirtual <= 0) return false;
    // Si el usuario no ingresó la máquina, validar solo contra CAJA_BUS (comportamiento anterior)
    const limite = this.maquinaIngresada ? this.disponibleParaDepositar : this.saldoCajaBus;
    return this.montoVirtual > limite;
  }

  /**
   * Saldo de CAJA_BUS después del depósito.
   * Puede quedar negativo temporalmente — se corrige con el INGRESO del cierre diario.
   */
  get saldoBusDespues(): number {
    return this.saldoCajaBus - (this.montoVirtual ?? 0);
  }

  // ──────────────────────────────
  // Getters comunes
  // ──────────────────────────────

  get tituloModal(): string {
    return this.tipo === 'CELULAR' ? 'Recarga del Proveedor - Celular' : 'Comprar Saldo - Bus';
  }

  get labelMonto(): string {
    return this.tipo === 'CELULAR' ? 'Monto virtual cargado' : 'Monto a depositar';
  }

  get iconoServicio(): string {
    return this.tipo === 'CELULAR' ? 'phone-portrait-outline' : 'bus-outline';
  }

  // ──────────────────────────────
  // Getters CELULAR
  // ──────────────────────────────

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

  // ──────────────────────────────
  // Acciones
  // ──────────────────────────────

  cerrar() {
    this.modalCtrl.dismiss();
  }

  async confirmar() {
    if (!this.montoVirtual || this.montoVirtual <= 0) {
      await this.ui.showError('Ingresá el monto');
      return;
    }

    try {
      const empleado = await this.service.obtenerEmpleadoActual();
      if (!empleado) {
        await this.ui.showError('No se pudo obtener el empleado');
        return;
      }

      let resultado;

      if (this.tipo === 'CELULAR') {
        resultado = await this.service.registrarRecargaProveedorCelularCompleto({
          fecha: this.service.getFechaLocal(),
          empleado_id: empleado.id,
          monto_virtual: this.montoVirtual
        });

        if (!resultado?.success) {
          await this.ui.showError('Error al registrar recarga');
          return;
        }

        await this.ui.showSuccess(
          `Recarga registrada: $${resultado.monto_virtual.toFixed(2)}\n` +
          `Deuda pendiente: $${resultado.monto_a_pagar.toFixed(2)}\n` +
          `Ganancia: $${resultado.ganancia.toFixed(2)}\n` +
          `Saldo Virtual Celular: $${resultado.saldo_virtual_celular.toFixed(2)}`
        );

        this.modalCtrl.dismiss({ success: true, data: resultado });

      } else {
        // BUS — pasa saldo_virtual_maquina si fue ingresado (habilita validación extendida en SQL)
        resultado = await this.service.registrarCompraSaldoBus({
          fecha: this.service.getFechaLocal(),
          empleado_id: empleado.id,
          monto: this.montoVirtual,
          saldo_virtual_maquina: this.saldoVirtualMaquina ?? undefined
        });

        if (!resultado) return;

        await this.ui.showSuccess(`Compra registrada: $${this.montoVirtual.toFixed(2)}`);
        this.modalCtrl.dismiss({ success: true });
      }
    } catch (error: any) {
      await this.ui.showError(error?.message || 'Error inesperado');
    }
  }
}
