import { Component, inject, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalController, IonIcon, IonButton } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline,
  fileTrayOutline,
  calculatorOutline,
  storefrontOutline,
  shieldCheckmarkOutline,
  phonePortraitOutline,
  busOutline,
  checkmarkCircleOutline,
  alertCircleOutline,
  informationCircleOutline,
  documentTextOutline,
  logoWhatsapp,
  cellularOutline
} from 'ionicons/icons';
import { CierreTurnoSnapshot } from '../../models/cierre-turno.model';
import { ShareCierreService } from '../../services/share-cierre.service';
import { formatFechaHoraEC, formatHoraEC } from '@core/utils/date.util';

@Component({
  selector: 'app-cierre-turno-detalle-modal',
  templateUrl: './cierre-turno-detalle-modal.component.html',
  styleUrls: ['./cierre-turno-detalle-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonIcon, IonButton]
})
export class CierreTurnoDetalleModalComponent {
  @Input({ required: true }) cierre!: CierreTurnoSnapshot;

  private modalCtrl = inject(ModalController);
  private shareCierreService = inject(ShareCierreService);

  constructor() {
    addIcons({
      closeOutline,
      fileTrayOutline,
      calculatorOutline,
      storefrontOutline,
      shieldCheckmarkOutline,
      phonePortraitOutline,
      busOutline,
      checkmarkCircleOutline,
      alertCircleOutline,
      informationCircleOutline,
      documentTextOutline,
      logoWhatsapp,
      cellularOutline
    });
  }

  cerrar(): void {
    this.modalCtrl.dismiss();
  }

  // ── Getters de presentación ─────────────────────────────────

  get fechaCierre(): string {
    return formatFechaHoraEC(this.cierre.hora_fecha_cierre);
  }

  get horaApertura(): string {
    return formatHoraEC(this.cierre.hora_fecha_apertura);
  }

  get horaCierre(): string {
    return formatHoraEC(this.cierre.hora_fecha_cierre);
  }

  get tieneMovimientos(): boolean {
    return this.cierre.ventas_pos_efectivo > 0
        || this.cierre.otros_ingresos > 0
        || this.cierre.egresos > 0;
  }

  get hasDiferencia(): boolean {
    return Math.abs(this.cierre.diferencia) > 0.001;
  }

  get efectivoEsperado(): number {
    // = efectivo_fisico − diferencia (saldo digital + fondo era lo esperado)
    return this.cierre.efectivo_fisico - this.cierre.diferencia;
  }

  get saldoCajonDigital(): number {
    // Lo que había en el cajón antes del fondo de apertura
    return this.efectivoEsperado - this.cierre.fondo_apertura;
  }

  get tieneDepositoAnticipadoBus(): boolean {
    return this.cierre.bus_habilitado && this.cierre.saldo_anterior_bus < 0;
  }

  // ── Compartir por WhatsApp ──────────────────────────────────

  async compartirWhatsApp(): Promise<void> {
    await this.shareCierreService.enviarResumenWhatsApp({
      numeroTurno:       this.cierre.numero_turno,
      cajeroNombre:      this.cierre.empleado_nombre,
      horaApertura:      this.cierre.hora_fecha_apertura,
      fondoApertura:     this.cierre.fondo_apertura,
      ventasPosEfectivo: this.cierre.ventas_pos_efectivo,
      otrosIngresos:     this.cierre.otros_ingresos,
      egresos:           this.cierre.egresos,
      efectivoFisico:    this.cierre.efectivo_fisico,
      diferencia:        this.cierre.diferencia,
      depositoTienda:    this.cierre.deposito_caja,
      saldoAnteriorCaja:    this.cierre.saldo_anterior_caja,
      saldoFinalCaja:       this.cierre.saldo_final_caja,
      variosActiva:         this.cierre.varios_activa,
      saldoAnteriorVarios:  this.cierre.saldo_anterior_varios,
      saldoFinalVarios:     this.cierre.saldo_final_varios,
      transferenciaVarios:  this.cierre.transferencia_varios,
      celularHabilitado:    this.cierre.celular_habilitado,
      saldoAnteriorCelular: this.cierre.saldo_anterior_celular,
      saldoFinalCelular:    this.cierre.saldo_final_celular,
      ventaCelular:         this.cierre.venta_celular,
      busHabilitado:        this.cierre.bus_habilitado,
      saldoAnteriorBus:     this.cierre.saldo_anterior_bus,
      saldoFinalBus:        this.cierre.saldo_final_bus,
      ventaBus:             this.cierre.venta_bus,
    });
  }
}
