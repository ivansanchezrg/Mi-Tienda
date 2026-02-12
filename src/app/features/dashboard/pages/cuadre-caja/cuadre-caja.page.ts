import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonCard, IonNote
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chevronBackOutline, phonePortraitOutline, busOutline,
  cashOutline, calculatorOutline, informationCircleOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { RecargasService } from '../../services/recargas.service';
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
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private ui = inject(UiService);
  private recargasService = inject(RecargasService);
  form!: FormGroup;
  loading = true;

  // Saldos anteriores (virtuales)
  saldoAnteriorCelular = 0;
  saldoAnteriorBus = 0;

  // Agregado hoy de recargas virtuales (v4.5)
  agregadoCelularHoy = 0;
  agregadoBusHoy = 0;

  constructor() {
    addIcons({
      chevronBackOutline,
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

    await this.cargarSaldosAnteriores();
  }

  ionViewWillEnter() {
    this.ui.hideTabs();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  async cargarSaldosAnteriores() {
    this.loading = true;
    try {
      const [saldos, agregado] = await Promise.all([
        this.recargasService.getSaldosAnteriores(),
        this.recargasService.getAgregadoVirtualHoy()
      ]);
      this.saldoAnteriorCelular = saldos.celular;
      this.saldoAnteriorBus = saldos.bus;
      this.agregadoCelularHoy = agregado.celular;
      this.agregadoBusHoy = agregado.bus;
    } catch (error) {
      console.error('Error al cargar saldos:', error);
      await this.ui.showError('Error al cargar saldos anteriores');
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

  // Cálculos de ventas (efectivo vendido) - v4.5
  get ventaCelular(): number {
    return (this.saldoAnteriorCelular + this.agregadoCelularHoy) - this.saldoCelularActual;
  }

  get ventaBus(): number {
    return (this.saldoAnteriorBus + this.agregadoBusHoy) - this.saldoBusActual;
  }

  // Validaciones (v4.5 — venta puede ser positiva incluso si saldo_actual > saldo_anterior)
  get ventaCelularValida(): boolean {
    return this.ventaCelular >= 0;
  }

  get ventaBusValida(): boolean {
    return this.ventaBus >= 0;
  }

  get mostrarResultado(): boolean {
    return this.form.valid && this.ventaCelularValida && this.ventaBusValida;
  }

  volver() {
    this.router.navigate(['/home']);
  }

  limpiar() {
    this.form.reset();
  }

}
