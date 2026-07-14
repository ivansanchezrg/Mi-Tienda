import { Component, inject, Input, ViewChild, ElementRef } from '@angular/core';
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
  arrowUpOutline
} from 'ionicons/icons';
import { CierreTurnoSnapshot } from '../../models/cierre-turno.model';
import { ShareCierreService } from '../../services/share-cierre.service';
import { formatFechaHoraEC, formatHoraEC } from '@core/utils/date.util';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';
import { crearScrollToTopElemento } from '@shared/utils/scroll-to-top.util';

@Component({
  selector: 'app-cierre-turno-detalle-modal',
  templateUrl: './cierre-turno-detalle-modal.component.html',
  styleUrls: ['./cierre-turno-detalle-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonIcon, IonButton, AppCurrencyPipe]
})
export class CierreTurnoDetalleModalComponent {
  @Input({ required: true }) cierre!: CierreTurnoSnapshot;

  @ViewChild('bsContent') private bsContentRef!: ElementRef<HTMLElement>;

  private modalCtrl = inject(ModalController);
  private shareCierreService = inject(ShareCierreService);

  /** Controller de scroll-to-top del contenido del modal (div.bs-content, no
   *  ion-content) — mismo patrón que el resto de la app, ver scroll-to-top.util.ts. */
  readonly scrollTop = crearScrollToTopElemento(() => this.bsContentRef?.nativeElement);

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
      arrowUpOutline
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
    return this.cierre.usa_pos;
  }

  get hasDiferencia(): boolean {
    return Math.abs(this.cierre.diferencia) > 0.001;
  }

  get saldoCajonDigital(): number {
    // cierre.efectivo_fisico = deposito_caja + transferencia_varios (dinero ya
    // distribuido tras el cierre), NO el conteo físico del empleado — no sirve
    // para reconstruir el acumulado del cajón. Se deriva de los mismos campos
    // que ya se muestran en "Movimientos del cajón" (misma fórmula que el
    // wizard en vivo, ver cierre-diario.page.ts → saldoCajaChicaDigital).
    return this.cierre.ventas_pos_efectivo + this.cierre.otros_ingresos - this.cierre.egresos;
  }

  get efectivoEsperado(): number {
    return this.saldoCajonDigital + this.cierre.fondo_apertura;
  }

  /** Conteo físico real reconstruido — para mostrar en el bloque de resultado del cuadre. */
  get conteoFisicoReal(): number {
    return this.efectivoEsperado + this.cierre.diferencia;
  }

  get tieneDepositoAnticipadoBus(): boolean {
    return this.cierre.bus_habilitado && this.cierre.saldo_anterior_bus < 0;
  }

  get esModoSinPos(): boolean {
    // usa_pos (fn_listar_cierres_turno v2.1) refleja cualquier movimiento del
    // cajón: ventas POS, ingresos manuales o egresos. Única fuente de verdad —
    // no recalcular desde los montos.
    return !this.cierre.usa_pos;
  }

  // ── Compartir por WhatsApp ──────────────────────────────────

  async compartirWhatsApp(): Promise<void> {
    // Fecha local de apertura vs cierre — el aviso de transferencia a Varios
    // pendiente aplica también al compartir un cierre desde el historial.
    const apertura = new Date(this.cierre.hora_fecha_apertura);
    const cierre   = new Date(this.cierre.hora_fecha_cierre);

    await this.shareCierreService.enviarResumenWhatsApp({
      numeroTurno:       this.cierre.numero_turno,
      cajeroNombre:      this.cierre.empleado_nombre,
      horaApertura:      this.cierre.hora_fecha_apertura,
      aperturaEnOtroDia: apertura.toDateString() !== cierre.toDateString(),
      esModoSinPos:      !this.cierre.usa_pos,
      observaciones:     this.cierre.observaciones,
      fondoApertura:     this.cierre.fondo_apertura,
      ventasPosEfectivo: this.cierre.ventas_pos_efectivo,
      otrosIngresos:     this.cierre.otros_ingresos,
      egresos:           this.cierre.egresos,
      // conteoFisicoReal (no cierre.efectivo_fisico = depósito+transferencia,
      // ver comentario en el getter) — el mensaje debe reflejar lo que el
      // empleado contó realmente, igual que el bloque de resultado del modal.
      efectivoFisico:    this.conteoFisicoReal,
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
