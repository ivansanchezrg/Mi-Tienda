import { Component, Input, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonInput, IonProgressBar,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, checkmarkCircleOutline, walletOutline,
  arrowForwardOutline, arrowBackOutline, alertCircleOutline
} from 'ionicons/icons';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { MovimientosEmpleadosService } from '../../services/movimientos-empleados.service';
import { AuthService } from '../../../auth/services/auth.service';
import { UiService } from '../../../../core/services/ui.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { ConfigService } from '../../../../core/services/config.service';
import {
  PreviewNomina, InstruccionFisica, DetalleDescuento, TIPO_MOVIMIENTO_CONFIG
} from '../../models/movimiento-empleado.model';

@Component({
  selector: 'app-pagar-nomina-modal',
  templateUrl: './pagar-nomina-modal.component.html',
  styleUrls: ['./pagar-nomina-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonInput, IonProgressBar,
    CurrencyInputDirective
  ]
})
export class PagarNominaModalComponent implements OnInit {

  @Input() empleadoId!: number;
  @Input() empleadoNombre = '';

  private modalCtrl = inject(ModalController);
  private service = inject(MovimientosEmpleadosService);
  private authService = inject(AuthService);
  private ui = inject(UiService);
  private configService = inject(ConfigService);
  public currencyService = inject(CurrencyService);

  readonly TIPO_CONFIG = TIPO_MOVIMIENTO_CONFIG;

  // Wizard state
  paso = 1;
  totalPasos = 3;

  // Paso 1: sueldo bruto
  sueldoStr = '';
  cargandoPreview = false;

  // Paso 2: preview
  preview: PreviewNomina | null = null;

  // Paso 3: confirmar
  guardando = false;

  // Resultado
  resultado: 'pendiente' | 'exito' | 'error' = 'pendiente';
  instrucciones: InstruccionFisica[] = [];
  liquidoPagado = 0;
  mensajeResultado = '';
  mensajeError = '';

  constructor() {
    addIcons({
      closeOutline, checkmarkCircleOutline, walletOutline,
      arrowForwardOutline, arrowBackOutline, alertCircleOutline
    });
  }

  async ngOnInit() {
    const config = await this.configService.get();
    if (config.nomina_sueldo_base > 0) {
      this.sueldoStr = this.currencyService.format(config.nomina_sueldo_base);
    }
  }

  get sueldoNumerico(): number {
    return this.currencyService.parse(this.sueldoStr);
  }

  get progreso(): number {
    return this.paso / this.totalPasos;
  }

  // ── Paso 1: Ingresar sueldo ──

  async avanzarAPaso2() {
    if (this.sueldoNumerico <= 0) {
      await this.ui.showError('El sueldo debe ser mayor a cero');
      return;
    }

    this.cargandoPreview = true;
    try {
      this.preview = await this.service.calcularPreviewNomina(
        this.empleadoId, this.sueldoNumerico
      );
      this.paso = 2;
    } finally {
      this.cargandoPreview = false;
    }
  }

  // ── Paso 2: Resumen de descuentos ──

  avanzarAPaso3() {
    if (!this.preview) return;
    // Si liquido <= 0, no hay paso 3 de instrucciones fisicas
    if (this.preview.liquido <= 0) {
      this.confirmarPago();
      return;
    }
    this.paso = 3;
  }

  retrocederAPaso1() {
    this.paso = 1;
    this.preview = null;
  }

  retrocederAPaso2() {
    this.paso = 2;
  }

  // ── Paso 3: Confirmar con instrucciones fisicas ──

  async confirmarPago() {
    if (this.guardando) return;
    this.guardando = true;

    try {
      const usuario = await this.authService.getUsuarioActual();
      if (!usuario) return;

      const res = await this.service.pagarNomina({
        empleadoId: usuario.id,
        beneficiarioId: this.empleadoId,
        sueldoBase: this.sueldoNumerico
      });

      if (res.success) {
        this.instrucciones = res.instrucciones_fisicas ?? [];
        this.liquidoPagado = res.liquido_pagado ?? 0;
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
