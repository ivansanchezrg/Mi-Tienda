import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonProgressBar, IonContent, IonList, IonItem, IonLabel,
  IonInput, IonIcon, IonNote, IonCard, IonCardHeader, IonCardTitle,
  IonCardContent, IonTextarea, AlertController, ToastController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline,
  arrowForwardOutline,
  phonePortraitOutline,
  busOutline,
  walletOutline,
  checkmarkCircleOutline,
  cashOutline,
  trendingUpOutline,
  calculatorOutline,
  informationCircleOutline,
  alertCircleOutline,
  checkmarkOutline
} from 'ionicons/icons';
import { CommonModule } from '@angular/common';
import { UiService } from '@core/services/ui.service';
import { HasPendingChanges } from '@core/guards/pending-changes.guard';
import { CurrencyService } from '@core/services/currency.service';
import { RecargasService } from '../../services/recargas.service';
import { TurnosCajaService } from '../../services/turnos-caja.service';
import { AuthService } from '../../../auth/services/auth.service';
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
    IonInput, IonIcon, IonNote, IonCard, IonCardHeader, IonCardTitle,
    IonCardContent, IonTextarea,
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
  private turnosCajaService = inject(TurnosCajaService);
  private authService = inject(AuthService);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private currencyService = inject(CurrencyService);

  // Estado
  pasoActual = 1;
  totalPasos = 2;

  // Saldos anteriores virtuales (del último registro de recargas)
  saldoAnteriorCelular = 0;
  saldoAnteriorBus = 0;

  // Agregado hoy de recargas virtuales (v4.5)
  agregadoCelularHoy = 0;
  agregadoBusHoy = 0;

  // Saldos anteriores de cajas físicas (del registro actual en tabla cajas)
  saldoAnteriorCaja = 0;
  saldoAnteriorCajaChica = 0;
  saldoAnteriorCajaCelular = 0;
  saldoAnteriorCajaBus = 0;

  // Configuración del sistema (v4.0)
  fondoFijo = 40;
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
      cashOutline,
      trendingUpOutline,
      calculatorOutline,
      informationCircleOutline,
      alertCircleOutline,
      checkmarkOutline
    });

    this.cierreForm = this.fb.group({
      // Solo 1 campo principal! (v4.0)
      efectivoTotalRecaudado: ['', [Validators.required]],
      // Recargas
      saldoVirtualCelularFinal: ['', [Validators.required]],
      saldoVirtualBusFinal: ['', [Validators.required]],
      // Opcional
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
   * Carga los datos iniciales necesarios para el cierre diario (v4.5)
   * Obtiene saldos virtuales, saldos de cajas, configuración y agregado del día
   * NOTA: La validación de cierre existente se hace en el home antes de navegar
   */
  async cargarDatosIniciales() {
    // Cargar todos los datos necesarios
    const datos = await this.recargasService.getDatosCierreDiario();

    // Saldos virtuales
    this.saldoAnteriorCelular = datos.saldosVirtuales.celular;
    this.saldoAnteriorBus = datos.saldosVirtuales.bus;

    // Agregado hoy (v4.5)
    this.agregadoCelularHoy = datos.agregadoCelularHoy;
    this.agregadoBusHoy = datos.agregadoBusHoy;

    // Saldos de cajas físicas
    this.saldoAnteriorCaja = datos.saldoCaja;
    this.saldoAnteriorCajaChica = datos.saldoCajaChica;
    this.saldoAnteriorCajaCelular = datos.saldoCajaCelular;
    this.saldoAnteriorCajaBus = datos.saldoCajaBus;

    // Configuración (v4.0)
    this.fondoFijo = datos.fondoFijo;
    this.transferenciaDiariaCajaChica = datos.transferenciaDiariaCajaChica;
  }

  hasPendingChanges(): boolean {
    return this.cierreForm.dirty;
  }

  // ==========================================
  // GETTERS: Valores del Formulario (v4.0 - Ultra-simplificado)
  // ==========================================

  /**
   * Obtiene el efectivo total contado al final del día
   * ¡El ÚNICO campo que el usuario necesita ingresar!
   * @returns {number} Efectivo recaudado (ingresado en Paso 1)
   */
  get efectivoRecaudado(): number {
    return this.cierreForm.get('efectivoTotalRecaudado')?.value || 0;
  }

  // ==========================================
  // GETTERS: Ventas del Día (v4.5 — Fórmula Corregida)
  // ==========================================

  /**
   * Calcula la venta del día de recargas celular (v4.5)
   * Fórmula: (saldo_anterior + agregado_hoy) - saldo_final
   * @returns {number} Monto vendido en recargas celular
   */
  get ventaCelular(): number {
    const saldoFinal = this.cierreForm.get('saldoVirtualCelularFinal')?.value || 0;
    return (this.saldoAnteriorCelular + this.agregadoCelularHoy) - saldoFinal;
  }

  /**
   * Calcula la venta del día de recargas bus (v4.5)
   * Fórmula: (saldo_anterior + agregado_hoy) - saldo_final
   * @returns {number} Monto vendido en recargas bus
   */
  get ventaBus(): number {
    const saldoFinal = this.cierreForm.get('saldoVirtualBusFinal')?.value || 0;
    return (this.saldoAnteriorBus + this.agregadoBusHoy) - saldoFinal;
  }

  /**
   * Detecta si alguna venta es negativa (v4.5)
   * Indica que falta registrar una recarga virtual del proveedor
   * @returns {boolean} True si alguna venta es negativa
   */
  get hayVentaNegativa(): boolean {
    return this.ventaCelular < 0 || this.ventaBus < 0;
  }

  // ==========================================
  // GETTERS: Cálculos del Cierre (v4.0 - Fórmula Final)
  // ==========================================

  /**
   * Calcula el dinero a depositar en CAJA PRINCIPAL (v4.0)
   * Fórmula: efectivo_recaudado - fondo_fijo - transferencia_caja_chica
   * @returns {number} Monto a depositar en caja principal
   */
  get dineroADepositar(): number {
    return this.efectivoRecaudado - this.fondoFijo - this.transferenciaDiariaCajaChica;
  }

  /**
   * Calcula el saldo final de CAJA (Principal) - v4.0
   * CAJA PRINCIPAL es una CAJA DE ACUMULACIÓN (como caja fuerte)
   * Fórmula: Saldo anterior + Dinero a depositar
   * @returns {number} Saldo final de caja principal
   */
  get saldoFinalCaja(): number {
    return this.saldoAnteriorCaja + this.dineroADepositar;
  }

  /**
   * Calcula el saldo final de CAJA_CHICA (v4.0)
   * Fórmula: Saldo anterior + Transferencia (físicamente separada del efectivo)
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

  /**
   * Calcula el total de saldos anteriores
   * @returns {number} Suma de todos los saldos anteriores
   */
  get totalAnterior(): number {
    return this.saldoAnteriorCaja +
           this.saldoAnteriorCajaChica +
           this.saldoAnteriorCajaCelular +
           this.saldoAnteriorCajaBus;
  }

  /**
   * Calcula el total de saldos finales
   * @returns {number} Suma de todos los saldos finales
   */
  get totalFinal(): number {
    return this.saldoFinalCaja +
           this.saldoFinalCajaChica +
           this.saldoFinalCajaCelular +
           this.saldoFinalCajaBus;
  }

  volver() {
    if (this.pasoActual > 1) {
      this.pasoAnterior();
    } else {
      this.router.navigate(['/home']);
    }
  }

  async siguientePaso() {
    if (this.pasoActual < this.totalPasos) {
      if (this.cierreForm.invalid) {
        Object.keys(this.cierreForm.controls).forEach(key =>
          this.cierreForm.get(key)?.markAsTouched()
        );
        return;
      }

      // Validar ventas negativas (v4.5)
      if (this.hayVentaNegativa) {
        const mensajes: string[] = [];
        if (this.ventaCelular < 0) {
          mensajes.push(`<strong>Celular:</strong> Venta negativa ($${this.ventaCelular.toFixed(2)})`);
        }
        if (this.ventaBus < 0) {
          mensajes.push(`<strong>Bus:</strong> Venta negativa ($${this.ventaBus.toFixed(2)})`);
        }

        await this.ui.showError(
          `<p>No podés continuar con ventas negativas.</p>
           ${mensajes.join('<br>')}
           <p style="margin-top: 12px;">Registrá las recargas del proveedor en <strong>Recargas Virtuales</strong> antes de cerrar.</p>`
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
   * Ejecuta el cierre diario completo usando función PostgreSQL (Versión 4.0)
   *
   * Llama a la función ejecutar_cierre_diario que realiza todas las operaciones
   * en una transacción atómica. Si algo falla, se hace rollback automático.
   */
  private async ejecutarCierre() {
    await this.ui.showLoading('Guardando cierre...');
    try {
      // 1. Parsear valores del formulario (convertir strings formateados a números)
      const efectivoRecaudado = this.currencyService.parse(this.cierreForm.get('efectivoTotalRecaudado')?.value);
      const saldoCelularFinal = this.currencyService.parse(this.cierreForm.get('saldoVirtualCelularFinal')?.value);
      const saldoBusFinal = this.currencyService.parse(this.cierreForm.get('saldoVirtualBusFinal')?.value);
      const observaciones = this.cierreForm.get('observaciones')?.value || null;

      // 2. Obtener ID del empleado actual desde Preferences (rápido, sin consulta a BD)
      const empleado = await this.authService.getEmpleadoActual();
      const empleadoId = empleado?.id || 1;

      // 3. Obtener turno activo (REQUERIDO en v4.1)
      const estadoCaja = await this.turnosCajaService.obtenerEstadoCaja();
      if (estadoCaja.estado !== 'TURNO_EN_CURSO' || !estadoCaja.turnoActivo) {
        await this.ui.hideLoading();
        await this.ui.showError('No hay un turno activo. Debes abrir caja primero.');
        return;
      }

      // 4. Preparar parámetros para la función (usa fecha local, no UTC)
      const fechaLocal = this.recargasService.getFechaLocal();

      // 5. Ejecutar cierre diario (transacción atómica) - Versión 4.1
      const resultado = await this.recargasService.ejecutarCierreDiario({
        turno_id: estadoCaja.turnoActivo.id,
        fecha: fechaLocal,
        empleado_id: empleadoId,
        // Solo 1 campo principal!
        efectivo_recaudado: efectivoRecaudado,
        // Recargas
        saldo_celular_final: saldoCelularFinal,
        saldo_bus_final: saldoBusFinal,
        saldo_anterior_celular: this.saldoAnteriorCelular,
        saldo_anterior_bus: this.saldoAnteriorBus,
        // Saldos de cajas
        saldo_anterior_caja: this.saldoAnteriorCaja,
        saldo_anterior_caja_chica: this.saldoAnteriorCajaChica,
        saldo_anterior_caja_celular: this.saldoAnteriorCajaCelular,
        saldo_anterior_caja_bus: this.saldoAnteriorCajaBus,
        // Opcional
        observaciones
      });

      // Verificar si hubo error (supabase.call retorna null en caso de error)
      if (!resultado) {
        // El error ya fue mostrado por supabase.call(), solo cerrar loading
        await this.ui.hideLoading();
        return; // No continuar
      }

      // Cerrar loading ANTES de navegar
      await this.ui.hideLoading();

      // Mostrar toast de éxito
      await this.ui.showSuccess('Cierre guardado correctamente');

      // NOTA: El turno se cierra automáticamente desde la función SQL (v4.1)
      // Ya no es necesario cerrarlo manualmente desde TypeScript

      // Limpiar formulario y navegar
      this.cierreForm.markAsPristine();
      this.resetState();

      // Pequeño delay para asegurar que el loading se cerró correctamente
      await new Promise(resolve => setTimeout(resolve, 100));

      // Query param para indicar que debe refrescar datos
      await this.router.navigate(['/home'], {
        queryParams: { refresh: Date.now() }
      });
    } catch (error: any) {
      await this.ui.hideLoading();
      const mensaje = error?.message || 'Error al guardar el cierre';
      await this.ui.showError(mensaje);
    }
  }

}
