import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonCard, IonNote, AlertController
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
  private alertCtrl = inject(AlertController);

  form!: FormGroup;
  loading = true;

  // Saldos anteriores (virtuales)
  saldoAnteriorCelular = 0;
  saldoAnteriorBus = 0;

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
      const saldos = await this.recargasService.getSaldosAnteriores();
      this.saldoAnteriorCelular = saldos.celular;
      this.saldoAnteriorBus = saldos.bus;
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

  // Cálculos de ventas (efectivo vendido)
  get ventaCelular(): number {
    return this.saldoAnteriorCelular - this.saldoCelularActual;
  }

  get ventaBus(): number {
    return this.saldoAnteriorBus - this.saldoBusActual;
  }

  // Validaciones
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

  /**
   * TEMPORAL - SOLO PARA TESTING
   * Confirma y guarda las recargas en la base de datos
   * Este método no debería existir en producción (Cuadre es solo visual)
   */
  async confirmarRecargas() {
    // Validar que haya resultado para confirmar
    if (!this.mostrarResultado) {
      await this.ui.showError('Completa los campos primero');
      return;
    }

    // Confirmar con el usuario
    const alert = await this.alertCtrl.create({
      header: 'Confirmar Recargas',
      message: '¿Guardar estas recargas en la base de datos? (Solo Testing)',
      buttons: [
        {
          text: 'Cancelar',
          role: 'cancel'
        },
        {
          text: 'Confirmar',
          role: 'confirm'
        }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();

    if (role !== 'confirm') return;

    // Mostrar loading
    await this.ui.showLoading('Guardando recargas...');

    try {
      // Obtener empleado actual
      const empleado = await this.recargasService.obtenerEmpleadoActual();
      if (!empleado) {
        throw new Error('No se pudo obtener el empleado actual');
      }

      // Preparar parámetros
      const params = {
        fecha: this.recargasService.getFechaLocal(),
        empleado_id: empleado.id,
        saldo_anterior_celular: this.saldoAnteriorCelular,
        saldo_actual_celular: this.saldoCelularActual,
        venta_celular: this.ventaCelular,
        saldo_anterior_bus: this.saldoAnteriorBus,
        saldo_actual_bus: this.saldoBusActual,
        venta_bus: this.ventaBus
      };

      // Ejecutar función PostgreSQL
      const resultado = await this.recargasService.registrarRecargasTesting(params);

      await this.ui.hideLoading();
      await this.ui.showSuccess('Recargas guardadas correctamente');

      // Navegar a Home con refresh
      await this.router.navigate(['/home'], { queryParams: { refresh: true } });

    } catch (error) {
      console.error('Error al confirmar recargas:', error);
      await this.ui.hideLoading();
      await this.ui.showError('Error al guardar las recargas');
    }
  }
}
