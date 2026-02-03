import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonProgressBar, IonContent, IonList, IonItem, IonLabel,
  IonInput, IonIcon, IonNote, IonCard, IonCardHeader,
  IonCardTitle, IonCardContent, IonTextarea, AlertController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline,
  arrowForwardOutline,
  phonePortraitOutline,
  busOutline,
  walletOutline,
  checkmarkCircleOutline,
  trendingUpOutline,
  cashOutline,
  calculatorOutline,
  informationCircleOutline,
  alertCircleOutline
} from 'ionicons/icons';
import { CommonModule } from '@angular/common';
import { UiService } from '@core/services/ui.service';
import { HasPendingChanges } from '@core/guards/pending-changes.guard';
import { CurrencyService } from '@core/services/currency.service';
import { RecargasService } from '../../services/recargas.service';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { NumbersOnlyDirective } from '@shared/directives/numbers-only.directive';
import { ScrollResetDirective } from '@shared/directives/scroll-reset.directive';

@Component({
  selector: 'app-cierre-diario',
  templateUrl: './cierre-diario.page.html',
  styleUrls: ['./cierre-diario.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonProgressBar, IonContent, IonList, IonItem, IonLabel,
    IonInput, IonIcon, IonNote, IonCard, IonCardHeader,
    IonCardTitle, IonCardContent, IonTextarea,
    CurrencyInputDirective,
    NumbersOnlyDirective,
    ScrollResetDirective
  ]
})
export class CierreDiarioPage implements OnInit, HasPendingChanges {
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private ui = inject(UiService);
  private recargasService = inject(RecargasService);
  private alertCtrl = inject(AlertController);
  private currencyService = inject(CurrencyService);

  // Estado
  pasoActual = 1;
  totalPasos = 2;

  // Saldos anteriores virtuales (del último registro de recargas)
  saldoAnteriorCelular = 0;
  saldoAnteriorBus = 0;

  // Saldos anteriores de cajas físicas (del registro actual en tabla cajas)
  saldoAnteriorCaja = 0;
  saldoAnteriorCajaChica = 0;
  saldoAnteriorCajaCelular = 0;
  saldoAnteriorCajaBus = 0;

  // Configuración del sistema
  transferenciaDiariaCajaChica = 20;

  // Formulario
  cierreForm: FormGroup;

  constructor() {
    addIcons({
      arrowBackOutline,
      arrowForwardOutline,
      phonePortraitOutline,
      busOutline,
      walletOutline,
      checkmarkCircleOutline,
      trendingUpOutline,
      cashOutline,
      calculatorOutline,
      informationCircleOutline,
      alertCircleOutline
    });

    this.cierreForm = this.fb.group({
      saldoVirtualCelularFinal: ['', [Validators.required]],
      saldoVirtualBusFinal: ['', [Validators.required]],
      efectivoTotalRecaudado: ['', [Validators.required]],
      observaciones: ['']
    });
  }

  ionViewWillEnter() {
    this.ui.hideTabs();
    this.cargarDatosIniciales();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  async ngOnInit() {
    this.resetState();
  }

  public resetState() {
    this.cierreForm.reset();
    this.cierreForm.markAsPristine();
    this.pasoActual = 1;
  }

  /**
   * Carga los datos iniciales necesarios para el cierre diario
   * Obtiene saldos virtuales, saldos de cajas y configuración del sistema
   */
  async cargarDatosIniciales() {
    const datos = await this.recargasService.getDatosCierreDiario();

    // Saldos virtuales
    this.saldoAnteriorCelular = datos.saldosVirtuales.celular;
    this.saldoAnteriorBus = datos.saldosVirtuales.bus;

    // Saldos de cajas físicas
    this.saldoAnteriorCaja = datos.saldoCaja;
    this.saldoAnteriorCajaChica = datos.saldoCajaChica;
    this.saldoAnteriorCajaCelular = datos.saldoCajaCelular;
    this.saldoAnteriorCajaBus = datos.saldoCajaBus;

    // Configuración
    this.transferenciaDiariaCajaChica = datos.transferenciaDiariaCajaChica;
  }

  hasPendingChanges(): boolean {
    return this.cierreForm.dirty;
  }

  // ==========================================
  // GETTERS: Ventas del Día
  // ==========================================

  /**
   * Calcula la venta del día de recargas celular
   * Fórmula: Saldo virtual anterior - Saldo virtual final
   * @returns {number} Monto vendido en recargas celular
   */
  get ventaCelular(): number {
    const saldoFinal = this.cierreForm.get('saldoVirtualCelularFinal')?.value || 0;
    return this.saldoAnteriorCelular - saldoFinal;
  }

  /**
   * Calcula la venta del día de recargas bus
   * Fórmula: Saldo virtual anterior - Saldo virtual final
   * @returns {number} Monto vendido en recargas bus
   */
  get ventaBus(): number {
    const saldoFinal = this.cierreForm.get('saldoVirtualBusFinal')?.value || 0;
    return this.saldoAnteriorBus - saldoFinal;
  }

  /**
   * Obtiene el efectivo total recaudado de ventas de tienda
   * @returns {number} Efectivo recaudado (ingresado en Paso 1)
   */
  get efectivoRecaudado(): number {
    return this.cierreForm.get('efectivoTotalRecaudado')?.value || 0;
  }

  // ==========================================
  // GETTERS: Verificación de Cajas
  // ==========================================

  /**
   * Calcula el saldo final de CAJA (Principal)
   * Fórmula: Saldo anterior + Efectivo recaudado - Transferencia a caja chica
   * @returns {number} Saldo final de caja principal
   */
  get saldoFinalCaja(): number {
    return this.saldoAnteriorCaja + this.efectivoRecaudado - this.transferenciaDiariaCajaChica;
  }

  /**
   * Calcula el saldo final de CAJA_CHICA
   * Fórmula: Saldo anterior + Transferencia desde caja principal
   * @returns {number} Saldo final de caja chica
   */
  get saldoFinalCajaChica(): number {
    return this.saldoAnteriorCajaChica + this.transferenciaDiariaCajaChica;
  }

  /**
   * Calcula el saldo final de CAJA_CELULAR
   * Fórmula: Saldo anterior + Venta de recargas celular
   * @returns {number} Saldo final de caja celular
   */
  get saldoFinalCajaCelular(): number {
    return this.saldoAnteriorCajaCelular + this.ventaCelular;
  }

  /**
   * Calcula el saldo final de CAJA_BUS
   * Fórmula: Saldo anterior + Venta de recargas bus
   * @returns {number} Saldo final de caja bus
   */
  get saldoFinalCajaBus(): number {
    return this.saldoAnteriorCajaBus + this.ventaBus;
  }

  volver() {
    if (this.pasoActual > 1) {
      this.pasoAnterior();
    } else {
      this.router.navigate(['/home']);
    }
  }

  siguientePaso() {
    if (this.pasoActual < this.totalPasos) {
      if (this.cierreForm.invalid) {
        Object.keys(this.cierreForm.controls).forEach(key =>
          this.cierreForm.get(key)?.markAsTouched()
        );
        return;
      }
      this.pasoActual++;
    }
  }

  pasoAnterior() {
    if (this.pasoActual > 1) {
      this.pasoActual--;
    }
  }

  async confirmarCierre() {
    const alert = await this.alertCtrl.create({
      header: 'Confirmar Cierre',
      message: '¿Estás seguro de que deseas cerrar el día?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Confirmar', role: 'confirm' }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role === 'confirm') {
      await this.ejecutarCierre();
    }
  }

  /**
   * Ejecuta el cierre diario completo usando función PostgreSQL
   *
   * Llama a la función ejecutar_cierre_diario que realiza todas las operaciones
   * en una transacción atómica. Si algo falla, se hace rollback automático.
   */
  private async ejecutarCierre() {
    await this.ui.showLoading('Guardando cierre...');
    try {
      // 1. Parsear valores del formulario (convertir strings formateados a números)
      const saldoCelularFinal = this.currencyService.parse(this.cierreForm.get('saldoVirtualCelularFinal')?.value);
      const saldoBusFinal = this.currencyService.parse(this.cierreForm.get('saldoVirtualBusFinal')?.value);
      const efectivoRecaudado = this.currencyService.parse(this.cierreForm.get('efectivoTotalRecaudado')?.value);
      const observaciones = this.cierreForm.get('observaciones')?.value || null;

      // 2. Obtener ID del empleado actual
      const user = await this.recargasService.obtenerEmpleadoActual();
      const empleadoId = user?.id || 1;

      // 3. Preparar parámetros para la función (usa fecha local, no UTC)
      const fechaLocal = this.recargasService.getFechaLocal();

      // 4. Ejecutar cierre diario (transacción atómica)
      await this.recargasService.ejecutarCierreDiario({
        fecha: fechaLocal,
        empleado_id: empleadoId,
        saldo_celular_final: saldoCelularFinal,
        saldo_bus_final: saldoBusFinal,
        efectivo_recaudado: efectivoRecaudado,
        saldo_anterior_celular: this.saldoAnteriorCelular,
        saldo_anterior_bus: this.saldoAnteriorBus,
        saldo_anterior_caja: this.saldoAnteriorCaja,
        saldo_anterior_caja_chica: this.saldoAnteriorCajaChica,
        saldo_anterior_caja_celular: this.saldoAnteriorCajaCelular,
        saldo_anterior_caja_bus: this.saldoAnteriorCajaBus,
        observaciones
      });

      await this.ui.showSuccess('Cierre guardado correctamente');
      this.cierreForm.markAsPristine();
      await this.router.navigate(['/home']);
      this.resetState();
    } catch (error: any) {
      const mensaje = error?.message || 'Error al guardar el cierre';
      this.ui.showError(mensaje);
    } finally {
      await this.ui.hideLoading();
    }
  }

}
