import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonCard, IonNote, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, phonePortraitOutline, busOutline,
  cashOutline, calculatorOutline, informationCircleOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { RecargasVirtualesService } from '@core/services/recargas-virtuales.service';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { NumbersOnlyDirective } from '@shared/directives/numbers-only.directive';

@Component({
  selector: 'app-cuadre-caja',
  templateUrl: './cuadre-caja.page.html',
  styleUrls: ['./cuadre-caja.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonCard, IonNote,
    CurrencyInputDirective,
    NumbersOnlyDirective
  ]
})
export class CuadreCajaPage implements OnInit {
  private modalCtrl = inject(ModalController);
  private fb = inject(FormBuilder);
  private ui = inject(UiService);
  private recargasVirtualesService = inject(RecargasVirtualesService);

  form!: FormGroup;
  loading = true;

  // Saldo virtual actual del sistema (último cierre + recargas proveedor pendientes)
  // Misma fórmula que en cierre-diario: getSaldoVirtualActual()
  saldoVirtualActualCelular = 0;
  saldoVirtualActualBus = 0;

  constructor() {
    addIcons({
      closeOutline,
      phonePortraitOutline,
      busOutline,
      cashOutline,
      calculatorOutline,
      informationCircleOutline
    });
  }

  async ngOnInit() {
    this.form = this.fb.group({
      saldoCelularActual: [null, [Validators.required, Validators.min(0)]],
      saldoBusActual: [null, [Validators.required, Validators.min(0)]]
    });

    await this.cargarDatos();
  }

  async cargarDatos() {
    this.loading = true;
    try {
      const [saldoVirtualCelular, saldoVirtualBus] = await Promise.all([
        this.recargasVirtualesService.getSaldoVirtualActual('CELULAR'),
        this.recargasVirtualesService.getSaldoVirtualActual('BUS')
      ]);
      this.saldoVirtualActualCelular = saldoVirtualCelular;
      this.saldoVirtualActualBus = saldoVirtualBus;
    } catch (error: any) {
      await this.ui.showError('Error al cargar datos del cuadre. Verificá tu conexión.');
    } finally {
      this.loading = false;
    }
  }

  // Getters para valores del formulario
  get saldoCelularActual(): number {
    return this.form.get('saldoCelularActual')?.value || 0;
  }

  get saldoBusActual(): number {
    return this.form.get('saldoBusActual')?.value || 0;
  }

  // Ventas = saldo que el sistema espera − saldo que la máquina muestra ahora
  // Misma fórmula que cierre-diario (v4.5)
  get ventaCelular(): number {
    return this.saldoVirtualActualCelular - this.saldoCelularActual;
  }

  get ventaBus(): number {
    return this.saldoVirtualActualBus - this.saldoBusActual;
  }

  get ventaCelularValida(): boolean {
    return this.ventaCelular >= 0;
  }

  get ventaBusValida(): boolean {
    return this.ventaBus >= 0;
  }

  get mostrarResultado(): boolean {
    return this.form.valid && this.ventaCelularValida && this.ventaBusValida;
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }

  limpiar() {
    this.form.reset();
  }
}

