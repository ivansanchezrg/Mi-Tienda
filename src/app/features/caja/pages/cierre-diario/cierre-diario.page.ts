import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonProgressBar, IonContent, IonList, IonItem, IonLabel,
  IonInput, IonIcon, IonNote, IonCard, IonCardHeader, IonCardTitle,
  IonCardContent, IonTextarea, AlertController, IonSkeletonText
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline,
  arrowForwardOutline,
  phonePortraitOutline,
  busOutline,
  walletOutline,
  archiveOutline,
  checkmarkCircleOutline,
  cashOutline,
  trendingUpOutline,
  calculatorOutline,
  informationCircleOutline,
  alertCircleOutline,
  receiptOutline,
  fileTrayOutline
} from 'ionicons/icons';
import { CommonModule } from '@angular/common';
import { UiService } from '@core/services/ui.service';
import { HasPendingChanges } from '@core/guards/pending-changes.guard';
import { CurrencyService } from '@core/services/currency.service';
import { ConfigService } from '@core/services/config.service';
import { RecargasService } from '../../services/recargas.service';
import { RecargasVirtualesService } from '../../../recargas-virtuales/services/recargas-virtuales.service';
import { TurnosCajaService } from '../../services/turnos-caja.service';
import { CajasService } from '../../services/cajas.service';
import { AuthService } from '../../../auth/services/auth.service';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { NumbersOnlyDirective } from '@shared/directives/numbers-only.directive';
import { getFechaLocal } from '@core/utils/date.util';
import { ScrollResetDirective } from '@shared/directives/scroll-reset.directive';
import { TurnoCajaConEmpleado } from '../../models/turno-caja.model';
import { ROUTES } from '@core/config/routes.config';

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
    IonCardContent, IonTextarea, IonSkeletonText,
    CurrencyInputDirective,
    NumbersOnlyDirective,
    ScrollResetDirective
  ]
})
export class CierreDiarioPage implements HasPendingChanges {
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private ui = inject(UiService);
  private recargasService = inject(RecargasService);
  private recargasVirtualesService = inject(RecargasVirtualesService);
  private turnosCajaService = inject(TurnosCajaService);
  private cajasService = inject(CajasService);
  private authService = inject(AuthService);
  private alertCtrl = inject(AlertController);
  private currencyService = inject(CurrencyService);
  private configService = inject(ConfigService);

  // ==========================================
  // ESTADO DEL WIZARD (v5: 2 pasos)
  // ==========================================
  pasoActual = 1;
  totalPasos = 2;
  cargandoDatos = true;

  // ==========================================
  // DATOS CARGADOS DE LA BD
  // ==========================================

  // Saldos virtuales anteriores (del último registro de recargas)
  saldoAnteriorCelular = 0;
  saldoAnteriorBus = 0;

  // Saldo virtual actual (saldo_anterior + agregado_hoy)
  saldoVirtualActualCelular = 0;
  saldoVirtualActualBus = 0;

  // Agregado pendiente de recargas virtuales
  agregadoCelularHoy = 0;
  agregadoBusHoy = 0;

  // Saldos de cajas virtuales (para cálculo de ventas y verificación)
  saldoAnteriorCajaCelular = 0;
  saldoAnteriorCajaBus = 0;

  // Datos del cajón físico (CAJA_CHICA)
  saldoCajaChicaDigital = 0;
  fondoFijo = 40;

  // Datos para preview de distribución
  transferenciaDiariaVarios = 20;
  transferenciaCajaChicaYaHecha = false;

  // Saldos actuales de CAJA y VARIOS (para mostrar antes → después en Paso 2)
  saldoAnteriorCaja = 0;    // CAJA (Tienda) antes del cierre
  saldoAnteriorVarios = 0;  // VARIOS antes del cierre

  // Turno activo (cargado en init para reutilizar en ejecutarCierre)
  turnoActivo: TurnoCajaConEmpleado | null = null;

  // Módulos habilitados (leídos de configuraciones)
  recargasCelularHabilitada = false;
  recargasBusHabilitada = false;
  variosActiva = false;

  // Conciliación real del turno (Paso 2)
  ventasPosEfectivo = 0;   // Ventas POS en efectivo registradas en el sistema
  egresos = 0;             // Egresos/gastos del cajón durante el turno

  // ==========================================
  // FORMULARIO
  // Paso 1: los 3 inputs principales
  // Paso 2: solo observaciones
  // ==========================================
  cierreForm: FormGroup;

  constructor() {
    addIcons({
      arrowBackOutline,
      arrowForwardOutline,
      phonePortraitOutline,
      busOutline,
      walletOutline,
      archiveOutline,
      checkmarkCircleOutline,
      cashOutline,
      trendingUpOutline,
      calculatorOutline,
      informationCircleOutline,
      alertCircleOutline,
      receiptOutline,
      fileTrayOutline
    });

    this.cierreForm = this.fb.group({
      // Paso 1 — validators dinámicos aplicados en cargarDatosIniciales() según módulos habilitados
      saldoVirtualCelularFinal: [''],
      saldoVirtualBusFinal:     [''],
      efectivoFisico:           ['', [Validators.required]],
      // Paso 2 — Observaciones opcionales
      observaciones: ['']
    });
  }

  ionViewWillEnter() {
    this.ui.hideTabs();
    this.resetState();
    this.cargarDatosIniciales();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  public resetState() {
    this.cierreForm.reset();
    this.cierreForm.markAsPristine();
    this.pasoActual = 1;
  }

  /**
   * Carga todos los datos necesarios para el wizard de cierre.
   *
   * Lote 1 (paralelo): datos del cierre + saldos virtuales + cajas + turno activo.
   * Lote 2 (secuencial): resumen del turno — necesita turnoId del lote 1.
   */
  async cargarDatosIniciales() {
    this.cargandoDatos = true;
    try {
      // Lote 1: todo en paralelo
      const [datos, saldoVirtualCelular, saldoVirtualBus, transferenciaYaHecha, saldosCajas, estadoCaja, config] = await Promise.all([
        this.recargasService.getDatosCierreDiario(),
        this.recargasVirtualesService.getSaldoUltimoCierre('CELULAR'),
        this.recargasVirtualesService.getSaldoUltimoCierre('BUS'),
        this.recargasService.verificarTransferenciaYaHecha(),
        this.cajasService.obtenerSaldosCajas(),
        this.turnosCajaService.obtenerEstadoCaja(),
        this.configService.get()
      ]);

      // Flags de módulos — condicionan inputs, validadores y datos enviados al SQL
      this.recargasCelularHabilitada = config?.recargas_celular_habilitada ?? false;
      this.recargasBusHabilitada     = config?.recargas_bus_habilitada     ?? false;
      this.variosActiva              = config?.caja_varios_activa          ?? false;

      // Aplicar validators dinámicos según módulos activos
      const celularCtrl = this.cierreForm.get('saldoVirtualCelularFinal');
      const busCtrl     = this.cierreForm.get('saldoVirtualBusFinal');
      if (this.recargasCelularHabilitada) {
        celularCtrl?.setValidators([Validators.required]);
      } else {
        celularCtrl?.clearValidators();
      }
      if (this.recargasBusHabilitada) {
        busCtrl?.setValidators([Validators.required]);
      } else {
        busCtrl?.clearValidators();
      }
      celularCtrl?.updateValueAndValidity();
      busCtrl?.updateValueAndValidity();

      // Saldos virtuales
      this.saldoAnteriorCelular      = datos.saldosVirtuales.celular;
      this.saldoAnteriorBus          = datos.saldosVirtuales.bus;
      this.saldoVirtualActualCelular = saldoVirtualCelular;
      this.saldoVirtualActualBus     = saldoVirtualBus;
      this.agregadoCelularHoy        = datos.agregadoCelularHoy;
      this.agregadoBusHoy            = datos.agregadoBusHoy;

      // Saldos de cajas de recargas
      this.saldoAnteriorCajaCelular = datos.saldoCajaCelular;
      this.saldoAnteriorCajaBus     = datos.saldoCajaBus;

      // Cajón físico
      this.saldoCajaChicaDigital = datos.saldoCajaChicaDigital;
      this.fondoFijo             = datos.fondoFijo;

      // Preview distribución
      this.transferenciaDiariaVarios     = datos.transferenciaDiariaVarios;
      this.transferenciaCajaChicaYaHecha = transferenciaYaHecha;

      // Saldos para verificación antes→después (Paso 2)
      this.saldoAnteriorCaja   = saldosCajas?.cajaPrincipal ?? 0;
      this.saldoAnteriorVarios = saldosCajas?.varios ?? 0;

      // Turno activo — guardarlo para reutilizar en ejecutarCierre()
      this.turnoActivo = estadoCaja.turnoActivo;

      // Lote 2: resumen del turno (necesita turnoId del lote 1)
      if (this.turnoActivo?.id) {
        const resumen = await this.turnosCajaService.getResumenTurnoActual(
          this.turnoActivo.id,
          this.turnoActivo.hora_fecha_apertura
        );
        this.ventasPosEfectivo = resumen.ventasPosEfectivo;
        this.egresos           = resumen.egresos;
      }
    } catch (error: any) {
      await this.ui.showError('Error al cargar los datos del cierre. Verifica tu conexión e intenta de nuevo.');
    } finally {
      this.cargandoDatos = false;
    }
  }

  hasPendingChanges(): boolean {
    return this.cierreForm.dirty;
  }

  // ==========================================
  // GETTERS — Paso 1: Saldos virtuales
  // ==========================================

  get saldoCelularFinal(): number {
    return this.currencyService.parse(this.cierreForm.get('saldoVirtualCelularFinal')?.value);
  }

  get saldoBusFinal(): number {
    return this.currencyService.parse(this.cierreForm.get('saldoVirtualBusFinal')?.value);
  }

  get ventaCelular(): number {
    return this.saldoEsperadoCelular - this.saldoCelularFinal;
  }

  get ventaBus(): number {
    return this.saldoEsperadoBus - this.saldoBusFinal;
  }

  get saldoEsperadoCelular(): number {
    return this.saldoVirtualActualCelular + this.agregadoCelularHoy;
  }

  get saldoEsperadoBus(): number {
    return this.saldoVirtualActualBus + this.agregadoBusHoy;
  }

  get hayVentaNegativa(): boolean {
    return this.ventaCelular < 0 || this.ventaBus < 0;
  }

  // ==========================================
  // GETTERS — Paso 1: Efectivo físico
  // ==========================================

  get efectivoFisico(): number {
    return this.currencyService.parse(this.cierreForm.get('efectivoFisico')?.value);
  }

  /** Efectivo esperado = saldo digital CAJA_CHICA + fondo fijo */
  get efectivoEsperado(): number {
    return this.saldoCajaChicaDigital + this.fondoFijo;
  }

  /** Diferencia = conteo físico - esperado (+ sobrante, - faltante) */
  get diferencia(): number {
    return this.efectivoFisico - this.efectivoEsperado;
  }

  get hasDiferencia(): boolean {
    return Math.abs(this.diferencia) > 0.001;
  }

  // ==========================================
  // GETTERS — Paso 2: Conciliación del turno
  // ==========================================

  /**
   * Ingresos manuales del turno (no POS).
   * Derivado algebraicamente: saldoDigital = ventasPOS + otrosIngresos - egresos
   * → otrosIngresos = saldoDigital - ventasPOS + egresos
   */
  get otrosIngresos(): number {
    return Math.max(0, this.saldoCajaChicaDigital - this.ventasPosEfectivo + this.egresos);
  }

  // ==========================================
  // GETTERS — Paso 2: Preview distribución
  // Lógica de cascada (todo o nada en cada nivel):
  //   1° VARIOS     — recibe si efectivo >= transferenciaDiaria completa
  //   2° Fondo fijo — queda en cajón si (efectivo - transferenciaVarios) >= fondoFijo
  //   3° Tienda     — recibe el resto (siempre >= 0)
  // ==========================================

  /**
   * Transferencia que recibirá VARIOS (prioridad 1).
   * Si Varios está inactiva → $0 (todo va a Tienda).
   * Recibe si efectivo >= transferenciaDiaria completa.
   * Si ya recibió hoy (2do turno) → $0.
   */
  get transferenciaPreviewVarios(): number {
    if (!this.variosActiva) return 0;
    if (this.transferenciaCajaChicaYaHecha) return 0;
    return this.efectivoFisico >= this.transferenciaDiariaVarios
      ? this.transferenciaDiariaVarios
      : 0;
  }

  /**
   * Fondo que efectivamente queda en el cajón (prioridad 2).
   * Queda solo si (efectivo - transferenciaVarios) >= fondoFijo.
   */
  get fondoDistribuidoPreview(): number {
    return (this.efectivoFisico - this.transferenciaPreviewVarios) >= this.fondoFijo
      ? this.fondoFijo
      : 0;
  }

  /** Depósito a CAJA: todo lo que no es VARIOS ni fondo */
  get depositoPreviewCaja(): number {
    return Math.max(0, this.efectivoFisico - this.transferenciaPreviewVarios - this.fondoDistribuidoPreview);
  }

  /** ¿VARIOS no recibirá hoy? (efectivo < transferenciaDiaria). Siempre false si Varios está inactiva. */
  get hayDeficitPreview(): boolean {
    if (!this.variosActiva) return false;
    if (this.transferenciaCajaChicaYaHecha) return false;
    return this.efectivoFisico < this.transferenciaDiariaVarios;
  }

  /** ¿El cajón quedará sin fondo? (efectivo - transferenciaVarios) < fondoFijo */
  get hayDeficitFondo(): boolean {
    return (this.efectivoFisico - this.transferenciaPreviewVarios) < this.fondoFijo;
  }

  /**
   * Monto a reponer desde Tienda en la próxima apertura.
   * - Déficit solo fondo → reponer fondoFijo
   * - Déficit fondo + VARIOS → reponer fondoFijo + transferenciaDiaria
   */
  get montoReposicionApertura(): number {
    let monto = 0;
    if (this.variosActiva && !this.transferenciaCajaChicaYaHecha && this.hayDeficitPreview) {
      monto += this.transferenciaDiariaVarios;
    }
    if (this.hayDeficitFondo) monto += this.fondoFijo;
    return monto;
  }

  // ==========================================
  // GETTERS — Paso 2: Saldos finales (antes → después)
  // ==========================================

  get saldoFinalCaja(): number {
    return this.saldoAnteriorCaja + this.depositoPreviewCaja;
  }

  get saldoFinalVarios(): number {
    return this.saldoAnteriorVarios + this.transferenciaPreviewVarios;
  }

  get saldoFinalCajaCelular(): number {
    return this.saldoAnteriorCajaCelular + this.ventaCelular;
  }

  get saldoFinalCajaBus(): number {
    return this.saldoAnteriorCajaBus + this.ventaBus;
  }

  // ==========================================
  // GETTERS — Bus depósito anticipado
  // ==========================================

  get tieneDepositoAnticipadoBus(): boolean {
    return this.saldoAnteriorCajaBus < 0;
  }

  // ==========================================
  // NAVEGACIÓN
  // ==========================================

  volver() {
    if (this.pasoActual > 1) {
      this.pasoActual--;
    } else {
      this.router.navigate([ROUTES.home]);
    }
  }

  async siguientePaso() {
    const celularCtrl  = this.cierreForm.get('saldoVirtualCelularFinal');
    const busCtrl      = this.cierreForm.get('saldoVirtualBusFinal');
    const efectivoCtrl = this.cierreForm.get('efectivoFisico');

    if (this.recargasCelularHabilitada) celularCtrl?.markAsTouched();
    if (this.recargasBusHabilitada)     busCtrl?.markAsTouched();
    efectivoCtrl?.markAsTouched();

    const celularInvalid = this.recargasCelularHabilitada && celularCtrl?.invalid;
    const busInvalid     = this.recargasBusHabilitada     && busCtrl?.invalid;
    if (celularInvalid || busInvalid || efectivoCtrl?.invalid) return;

    if (this.hayVentaNegativa) {
      const msgs: string[] = [];
      if (this.ventaCelular < 0) msgs.push(`<strong>Celular:</strong> venta negativa ($${this.ventaCelular.toFixed(2)})`);
      if (this.ventaBus    < 0) msgs.push(`<strong>Bus:</strong> venta negativa ($${this.ventaBus.toFixed(2)})`);
      await this.ui.showError(
        `<p>No puedes continuar con ventas negativas.</p>${msgs.join('<br>')}
         <p style="margin-top:12px">Registra las recargas del proveedor en <strong>Recargas Virtuales</strong> antes de cerrar.</p>`
      );
      return;
    }

    this.pasoActual = 2;
  }

  // ==========================================
  // CONFIRMACIÓN Y CIERRE
  // ==========================================

  async confirmarCierre() {
    const alert = await this.alertCtrl.create({
      header: 'Confirmar Cierre',
      message: '¿Confirmas el cierre del turno con los valores indicados?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Confirmar', role: 'confirm' }
      ]
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    if (role === 'confirm') await this.ejecutarCierre();
  }

  /**
   * Ejecuta el cierre diario (v5).
   * Envía efectivo_fisico al SQL → el SQL calcula ajuste,
   * transferencia a VARIOS y depósito a CAJA.
   */
  private async ejecutarCierre() {
    await this.ui.showLoading('Guardando cierre...');
    try {
      const saldoCelularFinal = this.recargasCelularHabilitada ? this.saldoCelularFinal : 0;
      const saldoBusFinal     = this.recargasBusHabilitada     ? this.saldoBusFinal     : 0;
      const efectivoFisico    = this.efectivoFisico;
      const observaciones     = this.cierreForm.get('observaciones')?.value || null;

      const empleado = await this.authService.getUsuarioActual();
      if (!empleado?.id) {
        await this.ui.hideLoading();
        await this.ui.showError('No se pudo identificar al usuario. Cierra sesión e ingresa de nuevo.');
        return;
      }

      // Reutilizar el turno cargado en init (evita query extra al confirmar)
      if (!this.turnoActivo?.id) {
        await this.ui.hideLoading();
        await this.ui.showError('No hay un turno activo. Debes abrir caja primero.');
        return;
      }

      const fechaLocal = getFechaLocal();

      const resultado = await this.recargasService.ejecutarCierreDiario({
        turno_id:     this.turnoActivo.id,
        fecha:        fechaLocal,
        empleado_id:  empleado.id,
        efectivo_fisico:             efectivoFisico,
        saldo_celular_final:         saldoCelularFinal,
        saldo_bus_final:             saldoBusFinal,
        saldo_anterior_celular:      this.saldoAnteriorCelular,
        saldo_anterior_bus:          this.saldoAnteriorBus,
        saldo_anterior_caja_celular: this.saldoAnteriorCajaCelular,
        saldo_anterior_caja_bus:     this.saldoAnteriorCajaBus,
        observaciones
      });

      if (!resultado) {
        await this.ui.hideLoading();
        return;
      }

      await this.ui.hideLoading();
      await this.ui.showSuccess('Cierre guardado correctamente');

      // Sincroniza turnoActivo$ inmediatamente para que el layout deshabilite el
      // tab POS sin esperar al round-trip del evento Realtime UPDATE.
      await this.turnosCajaService.refrescarTurnoActivo();

      this.cierreForm.markAsPristine();
      this.resetState();

      await new Promise(resolve => setTimeout(resolve, 100));
      await this.router.navigate([ROUTES.home], { queryParams: { refresh: Date.now() } });
    } catch (error: any) {
      await this.ui.hideLoading();
      await this.ui.showError(error?.message || 'Error al guardar el cierre');
    }
  }
}
