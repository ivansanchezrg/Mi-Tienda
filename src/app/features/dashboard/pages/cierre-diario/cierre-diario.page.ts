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

  // Saldos anteriores (del último registro)
  saldoAnteriorCelular = 0;
  saldoAnteriorBus = 0;

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

  async cargarDatosIniciales() {
    const saldos = await this.recargasService.getSaldosAnteriores();

    this.saldoAnteriorCelular = saldos.celular;
    this.saldoAnteriorBus = saldos.bus;

    console.log('Saldo anterior Celular:', this.saldoAnteriorCelular);
    console.log('Saldo anterior Bus:', this.saldoAnteriorBus);
  }

  hasPendingChanges(): boolean {
    return this.cierreForm.dirty;
  }

  // Getters para Ventas del Día
  get ventaCelular(): number {
    const saldoFinal = this.cierreForm.get('saldoVirtualCelularFinal')?.value || 0;
    return this.saldoAnteriorCelular - saldoFinal;
  }

  get ventaBus(): number {
    const saldoFinal = this.cierreForm.get('saldoVirtualBusFinal')?.value || 0;
    return this.saldoAnteriorBus - saldoFinal;
  }

  get efectivoRecaudado(): number {
    return this.cierreForm.get('efectivoTotalRecaudado')?.value || 0;
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

  private async ejecutarCierre() {
    await this.ui.showLoading('Guardando cierre...');
    try {
      // TODO: Guardar en Supabase
      await new Promise(resolve => setTimeout(resolve, 1000));

      await this.ui.showSuccess('Cierre guardado correctamente');
      this.cierreForm.markAsPristine();
      await this.router.navigate(['/home']);
      this.resetState();
    } catch {
      this.ui.showError('Error al guardar el cierre');
    } finally {
      await this.ui.hideLoading();
    }
  }
}
