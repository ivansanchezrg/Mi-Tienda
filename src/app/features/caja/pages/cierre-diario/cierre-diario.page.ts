import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonProgressBar, IonContent, IonList, IonItem, IonLabel,
  IonInput, IonIcon, IonNote, IonCard, IonCardHeader, IonCardTitle,
  IonCardContent, IonTextarea, IonSpinner, AlertController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline,
  arrowForwardOutline,
  phonePortraitOutline,
  busOutline,
  checkmarkCircleOutline,
  calculatorOutline,
  informationCircleOutline,
  alertCircleOutline,
  fileTrayOutline,
  storefrontOutline,
  shieldCheckmarkOutline
} from 'ionicons/icons';
import { CommonModule } from '@angular/common';
import { UiService } from '@core/services/ui.service';
import { HasPendingChanges } from '@core/guards/pending-changes.guard';
import { CurrencyService } from '@core/services/currency.service';
import { ConfigService } from '@core/services/config.service';
import { OutboxService } from '@core/services/outbox.service';
import { SyncService } from '@core/services/sync.service';
import { RecargasService } from '../../services/recargas.service';
import { TurnosCajaService } from '../../services/turnos-caja.service';
import { AuthService } from '../../../auth/services/auth.service';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { NumbersOnlyDirective } from '@shared/directives/numbers-only.directive';
import { getFechaLocal } from '@core/utils/date.util';
import { ShareCierreService, DatosCierreParaCompartir } from '../../services/share-cierre.service';
import { ScrollResetDirective } from '@shared/directives/scroll-reset.directive';
import { TurnoCajaConEmpleado } from '../../models/turno-caja.model';
import { ROUTES } from '@core/config/routes.config';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';

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
    IonCardContent, IonTextarea, IonSpinner,
    CurrencyInputDirective,
    NumbersOnlyDirective,
    ScrollResetDirective,
    AppCurrencyPipe
  ]
})
export class CierreDiarioPage implements HasPendingChanges {
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private ui = inject(UiService);
  private recargasService   = inject(RecargasService);
  private turnosCajaService = inject(TurnosCajaService);
  private authService       = inject(AuthService);
  private outbox            = inject(OutboxService);
  private sync              = inject(SyncService);
  private alertCtrl = inject(AlertController);
  private currencyService = inject(CurrencyService);
  private configService = inject(ConfigService);
  private shareCierreService = inject(ShareCierreService);

  // ==========================================
  // ESTADO DEL WIZARD (v5: 2 pasos)
  // ==========================================
  pasoActual = 1;
  totalPasos = 2;
  cargandoDatos = true;
  // Anti doble-tap en "Cerrar Caja" — bloquea reentradas durante la verificación
  // de la cola offline y la ejecución del cierre
  cerrando = false;

  // ==========================================
  // DATOS CARGADOS DE LA BD
  // ==========================================

  // Saldos virtuales anteriores (del último registro de recargas)
  saldoAnteriorCelular = 0;
  saldoAnteriorBus = 0;

  // Saldo virtual actual (snapshot + agregado) — total que debería haber en la máquina
  saldoVirtualActualCelular = 0;
  saldoVirtualActualBus = 0;

  // Saldos de cajas virtuales (para cálculo de ventas y verificación)
  saldoAnteriorCajaCelular = 0;
  saldoAnteriorCajaBus = 0;

  // Datos del cajón físico (CAJA_CHICA)
  saldoCajaChicaDigital = 0;
  /** Fondo declarado por el empleado al abrir el turno (turnoActivo.fondo_apertura) */
  fondoApertura = 0;

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

  // Modo sin POS: true cuando el turno no tuvo ventas registradas en el sistema
  esModoSinPos = false;

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
      checkmarkCircleOutline,
      calculatorOutline,
      informationCircleOutline,
      alertCircleOutline,
      fileTrayOutline,
      storefrontOutline,
      shieldCheckmarkOutline
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

  /** Carga todos los datos del wizard en una sola RPC (fn_datos_cierre_diario). */
  async cargarDatosIniciales() {
    this.cargandoDatos = true;
    try {
      // Invalidar config antes de cargar — garantiza flags frescos aunque el superadmin
      // haya cambiado módulos desde otro dispositivo sin que este tenga notificación.
      this.configService.invalidar();

      const datos = await this.turnosCajaService.obtenerDatosCierreDiario();

      // Flags de módulos — condicionan inputs y validadores
      this.recargasCelularHabilitada = datos.configuracion.recargasCelularHabilitada;
      this.recargasBusHabilitada     = datos.configuracion.recargasBusHabilitada;
      this.variosActiva              = datos.configuracion.cajaVariosActiva;

      // Aplicar validators dinámicos según módulos activos
      const celularCtrl = this.cierreForm.get('saldoVirtualCelularFinal');
      const busCtrl     = this.cierreForm.get('saldoVirtualBusFinal');
      celularCtrl?.setValidators(this.recargasCelularHabilitada ? [Validators.required] : []);
      busCtrl?.setValidators(this.recargasBusHabilitada         ? [Validators.required] : []);
      celularCtrl?.updateValueAndValidity();
      busCtrl?.updateValueAndValidity();

      // Turno activo
      this.turnoActivo   = datos.turnoActivo as any;
      this.fondoApertura = datos.turnoActivo?.fondo_apertura ?? 0;

      // saldoAnterior* = snapshot puro del último cierre (se envía al SQL para calcular venta)
      // saldoVirtualActual* = snapshot + agregado (total actual, para mostrar en UI)
      this.saldoAnteriorCelular      = datos.snapshotVirtuales.celular;
      this.saldoAnteriorBus          = datos.snapshotVirtuales.bus;
      this.saldoVirtualActualCelular = datos.saldosVirtuales.celular;
      this.saldoVirtualActualBus     = datos.saldosVirtuales.bus;

      // Saldos de cajas físicas
      this.saldoCajaChicaDigital    = datos.saldosCajas.cajaChicaDigital;
      this.saldoAnteriorCajaCelular = datos.saldosCajas.cajaCelular;
      this.saldoAnteriorCajaBus     = datos.saldosCajas.cajaBus;

      // Saldos para preview antes→después (Paso 2)
      this.saldoAnteriorCaja   = datos.saldosAntesCierre.caja;
      this.saldoAnteriorVarios = datos.saldosAntesCierre.varios;

      // Distribución
      this.transferenciaDiariaVarios     = datos.transferenciaDiariaVarios;
      this.transferenciaCajaChicaYaHecha = datos.transferenciaYaHecha;

      // Resumen del turno (ventas POS + egresos — ya calculados en la RPC)
      this.ventasPosEfectivo = datos.resumenTurno.ventasPosEfectivo;
      this.egresos           = datos.resumenTurno.egresos;

      this.esModoSinPos = this.ventasPosEfectivo === 0
                       && this.otrosIngresos      === 0
                       && this.egresos             === 0;
    } catch {
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
    return this.saldoVirtualActualCelular - this.saldoCelularFinal;
  }

  get ventaBus(): number {
    return this.saldoVirtualActualBus - this.saldoBusFinal;
  }

  get hayVentaNegativa(): boolean {
    return this.ventaCelular < 0 || this.ventaBus < 0;
  }

  // ==========================================
  // GETTERS — Paso 1
  // ==========================================

  get subtituloPaso1(): string {
    if (this.recargasCelularHabilitada || this.recargasBusHabilitada) {
      return 'Revisa los saldos virtuales e ingresa el efectivo físico contado.';
    }
    return 'Ingresa el efectivo contado en el cajón al cerrar el turno.';
  }

  // ==========================================
  // GETTERS — Paso 1: Efectivo físico
  // ==========================================

  get efectivoFisico(): number {
    return this.currencyService.parse(this.cierreForm.get('efectivoFisico')?.value);
  }

  /** Efectivo esperado = saldo digital CAJA_CHICA + fondo declarado al abrir */
  get efectivoEsperado(): number {
    return this.saldoCajaChicaDigital + this.fondoApertura;
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
  // Cascada simplificada (fondo libre — sin nivel "fondo en cajón"):
  //   1° VARIOS  — recibe si efectivo >= transferenciaDiaria completa
  //   2° Tienda  — recibe todo el resto (siempre >= 0)
  // El fondo del próximo turno lo declara el empleado al abrir, no proviene del cierre.
  // ==========================================

  /**
   * Transferencia que recibirá VARIOS.
   * Si Varios está inactiva → $0 (todo va a Tienda).
   * Recibe solo si efectivo >= transferenciaDiaria completa.
   * Si ya recibió hoy (2do turno) → $0.
   */
  get transferenciaPreviewVarios(): number {
    if (!this.variosActiva) return 0;
    if (this.transferenciaCajaChicaYaHecha) return 0;
    return this.efectivoFisico >= this.transferenciaDiariaVarios
      ? this.transferenciaDiariaVarios
      : 0;
  }

  /** Depósito a CAJA: todo lo que no va a VARIOS */
  get depositoPreviewCaja(): number {
    return Math.max(0, this.efectivoFisico - this.transferenciaPreviewVarios);
  }

  /** ¿VARIOS no recibirá hoy? (efectivo < transferenciaDiaria). Siempre false si Varios está inactiva. */
  get hayDeficitPreview(): boolean {
    if (!this.variosActiva) return false;
    if (this.transferenciaCajaChicaYaHecha) return false;
    return this.efectivoFisico < this.transferenciaDiariaVarios;
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
      // Texto plano: los toasts/alerts de Ionic en Android sanitizan el HTML y lo
      // mostrarían como etiquetas literales. Montos siempre via CurrencyService.
      const msgs: string[] = [];
      if (this.ventaCelular < 0) msgs.push(`Celular: venta negativa (-$${this.currencyService.format(Math.abs(this.ventaCelular))})`);
      if (this.ventaBus    < 0) msgs.push(`Bus: venta negativa (-$${this.currencyService.format(Math.abs(this.ventaBus))})`);
      await this.ui.showError(
        `No puedes continuar con ventas negativas. ${msgs.join('. ')}. ` +
        `Registra las recargas del proveedor en Recargas Virtuales antes de cerrar.`
      );
      return;
    }

    this.pasoActual = 2;
  }

  // ==========================================
  // CONFIRMACIÓN Y CIERRE
  // ==========================================

  async confirmarCierre() {
    if (this.cerrando) return;
    this.cerrando = true;
    try {
      // Barrera del cierre (§4.7 PLAN-OFFLINE-POS): no cerrar con ventas offline sin sincronizar.
      // Esas ventas llegarían al servidor DESPUÉS del cierre → el saldo_digital del cajón quedaría
      // incompleto → cuadre incorrecto y posible FALTANTE_CAJA injusto. Se drena la cola primero.
      if (!(await this.colaSincronizadaParaCerrar())) return;

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
    } finally {
      this.cerrando = false;
    }
  }

  /**
   * Garantiza que no queden ventas offline en cola antes de cerrar.
   * Si hay pendientes, intenta drenarlas (el cierre siempre es online). Si tras el
   * intento siguen pendientes, bloquea el cierre y guía al usuario a revisarlas.
   * Devuelve true si la cola está vacía y se puede cerrar.
   */
  private async colaSincronizadaParaCerrar(): Promise<boolean> {
    if (await this.outbox.cantidadPendientes() === 0) return true;

    await this.ui.showLoading('Sincronizando ventas pendientes...');
    await this.sync.sincronizar();
    await this.ui.hideLoading();

    const restantes = await this.outbox.cantidadPendientes();
    if (restantes === 0) return true;

    await this.ui.showError(
      `Hay ${restantes} venta(s) sin sincronizar. No se puede cerrar el turno hasta subirlas. ` +
      `Verifica tu conexión e intenta de nuevo.`
    );
    return false;
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

      // Fecha local de apertura del turno — si difiere del día del cierre, el
      // turno quedó abierto de un día anterior y la transferencia diaria a
      // Varios de ese día no se realizó. El home muestra el aviso post-cierre.
      const fechaApertura = new Date(this.turnoActivo.hora_fecha_apertura);
      const aperturaLocal = `${fechaApertura.getFullYear()}-${String(fechaApertura.getMonth() + 1).padStart(2, '0')}-${String(fechaApertura.getDate()).padStart(2, '0')}`;

      // Capturar todos los valores del paso 2 ANTES de resetState(),
      // porque resetState() llama cierreForm.reset() y los getters que
      // leen el formulario (efectivoFisico, saldoCelularFinal, etc.) devolverían 0.
      const datosCierre: DatosCierreParaCompartir = {
        numeroTurno:       this.turnoActivo.numero_turno,
        esModoSinPos:      this.esModoSinPos,
        observaciones:     this.cierreForm.get('observaciones')?.value || null,
        cajeroNombre:      this.turnoActivo.empleado?.nombre ?? empleado.nombre,
        horaApertura:      this.turnoActivo.hora_fecha_apertura,
        aperturaEnOtroDia: aperturaLocal !== fechaLocal,
        fondoApertura:     this.fondoApertura,
        ventasPosEfectivo: this.ventasPosEfectivo,
        otrosIngresos:     this.otrosIngresos,
        egresos:           this.egresos,
        efectivoFisico:    this.efectivoFisico,
        diferencia:        this.diferencia,
        depositoTienda:    this.depositoPreviewCaja,
        saldoAnteriorCaja:    this.saldoAnteriorCaja,
        saldoFinalCaja:       this.saldoFinalCaja,
        variosActiva:         this.variosActiva,
        saldoAnteriorVarios:  this.saldoAnteriorVarios,
        saldoFinalVarios:     this.saldoFinalVarios,
        transferenciaVarios:  this.transferenciaPreviewVarios,
        celularHabilitado:    this.recargasCelularHabilitada,
        saldoAnteriorCelular: this.saldoAnteriorCajaCelular,
        saldoFinalCelular:    this.saldoFinalCajaCelular,
        ventaCelular:         this.ventaCelular,
        busHabilitado:        this.recargasBusHabilitada,
        saldoAnteriorBus:     this.saldoAnteriorCajaBus,
        saldoFinalBus:        this.saldoFinalCajaBus,
        ventaBus:             this.ventaBus,
      };

      // Sincroniza turnoActivo$ inmediatamente
      await this.turnosCajaService.refrescarTurnoActivo();

      this.cierreForm.markAsPristine();
      this.resetState();

      // Guardar datos para que el home abra el modal de compartir al detectar el pendiente
      this.shareCierreService.guardarPendiente(datosCierre);

      await this.router.navigate([ROUTES.home]);
    } catch (error: any) {
      await this.ui.hideLoading();
      await this.ui.showError(error?.message || 'Error al guardar el cierre');
    }
  }

}
