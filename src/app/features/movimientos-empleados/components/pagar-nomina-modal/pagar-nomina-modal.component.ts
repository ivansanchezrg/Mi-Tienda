import { Component, Input, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonProgressBar,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, checkmarkCircleOutline, walletOutline,
  arrowForwardOutline, arrowBackOutline, alertCircleOutline,
  informationCircleOutline, arrowForwardCircleOutline
} from 'ionicons/icons';
import { MovimientosEmpleadosService } from '../../services/movimientos-empleados.service';
import { AuthService } from '../../../auth/services/auth.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { ConfigService } from '../../../../core/services/config.service';
import {
  PreviewNomina, InstruccionFisica, TIPO_MOVIMIENTO_CONFIG,
  ProporcionalInfo, CasoPagoNomina
} from '../../models/movimiento-empleado.model';

@Component({
  selector: 'app-pagar-nomina-modal',
  templateUrl: './pagar-nomina-modal.component.html',
  styleUrls: ['./pagar-nomina-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonProgressBar,
  ]
})
export class PagarNominaModalComponent implements OnInit {

  @Input() empleadoId!: string;
  @Input() empleadoNombre = '';

  private modalCtrl = inject(ModalController);
  private service = inject(MovimientosEmpleadosService);
  private authService = inject(AuthService);
  private configService = inject(ConfigService);
  protected currencyService = inject(CurrencyService);

  readonly TIPO_CONFIG = TIPO_MOVIMIENTO_CONFIG;

  // Wizard state
  paso = 1;
  totalPasos = 2;

  // Sueldo leído de config (o proporcional si fue transferido)
  sueldoNumericoBase = 0;
  cargandoPreview = false;

  // Paso 1: preview
  preview: PreviewNomina | null = null;

  // Paso 2: confirmar
  guardando = false;

  // Resultado
  resultado: 'pendiente' | 'exito' | 'error' = 'pendiente';
  casoPago: CasoPagoNomina | null = null;
  instrucciones: InstruccionFisica[] = [];
  liquidoPagado = 0;
  arrastreMonto = 0;
  mensajeResultado = '';
  mensajeError = '';

  // Info de proporcional — solo presente si el empleado fue transferido
  proporcionalInfo: ProporcionalInfo | null = null;

  constructor() {
    addIcons({
      closeOutline, checkmarkCircleOutline, walletOutline,
      arrowForwardOutline, arrowBackOutline, alertCircleOutline,
      informationCircleOutline, arrowForwardCircleOutline
    });
  }

  async ngOnInit() {
    this.cargandoPreview = true;
    try {
      await this._cargarPreview();
    } finally {
      this.cargandoPreview = false;
    }
  }

  private async _cargarPreview() {
    const config = await this.configService.get();
    this.sueldoNumericoBase = config.nomina_sueldo_base;

    // Proporcional y sueldo base en paralelo no es posible (proporcional necesita sueldoBase),
    // pero sí podemos esperar proporcional antes de calcular preview para tener el sueldo correcto.
    this.proporcionalInfo = await this.service.obtenerProporcional(
      this.empleadoId, this.sueldoNumericoBase
    );

    // Preview recibe proporcionalInfo ya calculado — no duplica la lógica
    this.preview = await this.service.calcularPreviewNomina(
      this.empleadoId, this.sueldoNumerico, this.proporcionalInfo
    );
  }

  get sueldoNumerico(): number {
    return this.proporcionalInfo
      ? this.proporcionalInfo.sueldoSugerido
      : this.sueldoNumericoBase;
  }

  get progreso(): number {
    return this.paso / this.totalPasos;
  }

  // ── Paso 1: Resumen de descuentos ──

  async avanzarAPaso2() {
    if (!this.preview || this.cargandoPreview) return;

    // Refrescar preview antes de avanzar: puede haber habido un adelanto o ajuste
    // entre que se abrió el modal y que el admin hace clic en "Pagar".
    // Esto sincroniza el preview con lo que la función SQL va a calcular.
    this.cargandoPreview = true;
    try {
      await this._cargarPreview();
    } finally {
      this.cargandoPreview = false;
    }

    if (!this.preview) return;

    // Si liquido <= 0, confirmar directo sin instrucciones fisicas
    if (this.preview.liquido <= 0) {
      this.confirmarPago();
      return;
    }
    this.paso = 2;
  }

  retrocederAPaso1() {
    this.paso = 1;
  }

  // ── Paso 3: Confirmar con instrucciones fisicas ──

  async confirmarPago() {
    if (this.guardando) return;
    this.guardando = true;

    try {
      const usuario = await this.authService.getUsuarioActual();
      if (!usuario) return;

      // Derivar fechas de periodo para trazabilidad
      const periodoInicio = this.proporcionalInfo?.fechaDesde
        ? new Date(this.proporcionalInfo.fechaDesde).toISOString().split('T')[0]
        : undefined;
      const periodoFin = this.proporcionalInfo?.fechaHasta
        ? new Date(this.proporcionalInfo.fechaHasta).toISOString().split('T')[0]
        : undefined;

      const res = await this.service.pagarNomina({
        empleadoId: usuario.id,
        beneficiarioId: this.empleadoId,
        sueldoBase: this.sueldoNumerico,
        periodoInicio,
        periodoFin
      });

      if (res.success) {
        this.casoPago = res.caso ?? null;
        this.instrucciones = res.instrucciones_fisicas ?? [];
        this.liquidoPagado = res.liquido_pagado ?? 0;
        this.arrastreMonto = res.arrastre ?? 0;
        this.mensajeResultado = res.mensaje ?? '';
        this.resultado = 'exito';
      } else {
        this.mensajeError = res.error ?? 'Error desconocido';
        this.resultado = 'error';
      }
    } finally {
      this.guardando = false;
    }
  }

  async reintentar() {
    this.resultado = 'pendiente';
    this.paso = 1;
    this.cargandoPreview = true;
    try {
      await this._cargarPreview();
    } finally {
      this.cargandoPreview = false;
    }
  }

  tipoLabel(tipo: string): string {
    const config = TIPO_MOVIMIENTO_CONFIG[tipo as keyof typeof TIPO_MOVIMIENTO_CONFIG];
    return config?.label ?? tipo;
  }

  cerrar() {
    this.modalCtrl.dismiss(
      this.resultado === 'exito' ? { registrado: true } : undefined
    );
  }
}
