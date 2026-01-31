import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonProgressBar,
  IonContent,
  IonList,
  IonItem,
  IonLabel,
  IonInput,
  IonTextarea,
  IonIcon,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonNote,
  IonButton,
  AlertController,
  IonSpinner
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowForwardOutline,
  arrowBackOutline,
  walletOutline,
  phonePortraitOutline,
  busOutline,
  cashOutline,
  checkmarkCircleOutline,
  alertCircleOutline,
  informationCircleOutline,
  trendingUpOutline,
  calculatorOutline
} from 'ionicons/icons';
import { DecimalPipe, CommonModule } from '@angular/common';
import { UiService } from '@core/services/ui.service';
import { HasPendingChanges } from '@core/guards/pending-changes.guard';
import { CurrencyService } from '@core/services/currency.service';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { ScrollResetDirective } from '@shared/directives/scroll-reset.directive';

/**
 * Page para realizar el cierre diario de caja.
 */
@Component({
  selector: 'app-cierre-diario',
  templateUrl: './cierre-diario.page.html',
  styleUrls: ['./cierre-diario.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    DecimalPipe,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonProgressBar,
    IonContent,
    IonList,
    IonItem,
    IonLabel,
    IonInput,
    IonTextarea,
    IonIcon,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonNote,
    IonButton,
    IonSpinner,
    CurrencyInputDirective,
    ScrollResetDirective
  ]
})
export class CierreDiarioPage implements OnInit, HasPendingChanges {
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private ui = inject(UiService);
  private alertCtrl = inject(AlertController);
  private currencyService = inject(CurrencyService);

  // Estado de la página
  isLoading = true;
  pasoActual = 1;
  totalPasos = 2;

  // Formulario
  cierreForm: FormGroup;

  // Datos reales (se cargarán desde DB)
  saldosAnteriores = {
    celular: 0,
    bus: 0,
    cajaPrincipal: 0,
    cajaChica: 0,
    cajaCelular: 0,
    cajaBus: 0
  };

  configuracion = {
    transferenciaDiaria: 20.00
  };

  constructor() {
    addIcons({
      arrowForwardOutline,
      arrowBackOutline,
      walletOutline,
      phonePortraitOutline,
      busOutline,
      cashOutline,
      checkmarkCircleOutline,
      alertCircleOutline,
      informationCircleOutline,
      trendingUpOutline,
      calculatorOutline
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
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  async ngOnInit() {
    this.resetState();
    await this.cargarDatosIniciales();
  }

  /**
   * Reinicia el formulario y el estado del wizard a sus valores iniciales.
   */
  public resetState() {
    this.cierreForm.reset({
      saldoVirtualCelularFinal: '',
      saldoVirtualBusFinal: '',
      efectivoTotalRecaudado: '',
      observaciones: ''
    });
    this.cierreForm.markAsPristine();
    this.pasoActual = 1;
  }

  async cargarDatosIniciales() {
    this.isLoading = true;
    try {
      // Simulación de carga
      await new Promise(resolve => setTimeout(resolve, 800));
    } catch (error) {
      this.ui.showToast('Error al cargar saldos', 'danger');
    } finally {
      this.isLoading = false;
    }
  }

  hasPendingChanges(): boolean {
    return this.cierreForm.dirty;
  }

  /**
   * Si está en paso > 1, retrocede un paso. Si está en paso 1, navega al home.
   * El Guard se encargará de pedir confirmación si hay cambios.
   */
  volver() {
    if (this.pasoActual > 1) {
      this.pasoAnterior();
    } else {
      this.router.navigate(['/home']);
    }
  }

  /**
   * Avanza al siguiente paso
   */
  siguientePaso() {
    if (this.pasoActual < this.totalPasos) {
      if (this.pasoActual === 1 && this.cierreForm.invalid) {
        Object.keys(this.cierreForm.controls).forEach(key => this.cierreForm.get(key)?.markAsTouched());
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

  /**
   * Muestra diálogo de confirmación antes de ejecutar el cierre.
   */
  async confirmarCierre() {
    const alert = await this.alertCtrl.create({
      header: 'Confirmar Cierre',
      message: '¿Estás seguro de que deseas cerrar el día? Esta acción no se puede deshacer.',
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
   * Ejecuta la lógica final de cierre en la base de datos.
   */
  private async ejecutarCierre() {
    await this.ui.showLoading('Guardando cierre...');
    try {
      // TODO: Implementar transacción real en Supabase...
      await new Promise(resolve => setTimeout(resolve, 1500));

      await this.ui.showToast('Cierre diario guardado correctamente', 'success');

      // Limpiar dirty para que el guard permita salir
      this.cierreForm.markAsPristine();

      // Navegar primero, resetear después.
      // Si resetState() va antes, cambia pasoActual y dispara el scroll
      // de cierre-diario al mismo tiempo que el de home → race condition.
      await this.router.navigate(['/home']);
      this.resetState();
    } catch {
      this.ui.showToast('Hubo un error al guardar el cierre', 'danger');
    } finally {
      await this.ui.hideLoading();
    }
  }

  // --- GETTERS USANDO EL SERVICIO ---

  get ventaCelular(): number {
    const val = this.currencyService.parse(this.cierreForm.get('saldoVirtualCelularFinal')?.value);
    return Math.max(0, this.saldosAnteriores.celular - val);
  }

  get ventaBus(): number {
    const val = this.currencyService.parse(this.cierreForm.get('saldoVirtualBusFinal')?.value);
    return Math.max(0, this.saldosAnteriores.bus - val);
  }

  get efectivoRecaudado(): number {
    return this.currencyService.parse(this.cierreForm.get('efectivoTotalRecaudado')?.value);
  }

  get cajaFinal(): number {
    return this.saldosAnteriores.cajaPrincipal - this.configuracion.transferenciaDiaria;
  }

  get cajaChicaFinal(): number {
    return this.saldosAnteriores.cajaChica + this.configuracion.transferenciaDiaria;
  }

  get efectivoCelular(): number {
    const total = this.ventaCelular + this.ventaBus;
    return total > 0 ? (this.efectivoRecaudado * (this.ventaCelular / total)) : 0;
  }

  get efectivoBus(): number {
    const total = this.ventaCelular + this.ventaBus;
    return total > 0 ? (this.efectivoRecaudado * (this.ventaBus / total)) : 0;
  }

  get cajaCelularFinal(): number {
    return this.saldosAnteriores.cajaCelular + this.efectivoCelular;
  }

  get cajaBusFinal(): number {
    return this.saldosAnteriores.cajaBus + this.efectivoBus;
  }

}