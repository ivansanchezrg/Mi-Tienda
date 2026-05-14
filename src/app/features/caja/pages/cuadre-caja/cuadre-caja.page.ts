import { Component, inject, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonButton, IonIcon, IonSkeletonText, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, phonePortraitOutline, busOutline,
  cashOutline, scaleOutline, informationCircleOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { RecargasVirtualesService } from '../../../recargas-virtuales/services/recargas-virtuales.service';
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
    IonButton, IonIcon, IonSkeletonText,
    CurrencyInputDirective,
    NumbersOnlyDirective
  ]
})
export class CuadreCajaPage implements OnInit {
  @ViewChild('saldoCelularInput') saldoCelularInputRef!: ElementRef<HTMLInputElement>;

  private modalCtrl = inject(ModalController);
  private fb = inject(FormBuilder);
  private ui = inject(UiService);
  private recargasVirtualesService = inject(RecargasVirtualesService);

  form!: FormGroup;

  // Saldo virtual actual del sistema (último cierre + recargas proveedor pendientes)
  // Misma fórmula que en cierre-diario: getSaldoVirtualActual()
  saldoVirtualActualCelular = 0;
  saldoVirtualActualBus = 0;
  loading = true;

  constructor() {
    addIcons({
      closeOutline,
      phonePortraitOutline,
      busOutline,
      cashOutline,
      scaleOutline,
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
    this.form.disable();
    try {
      const [saldoVirtualCelular, saldoVirtualBus] = await Promise.all([
        this.recargasVirtualesService.getSaldoUltimoCierre('CELULAR'),
        this.recargasVirtualesService.getSaldoUltimoCierre('BUS')
      ]);
      this.saldoVirtualActualCelular = saldoVirtualCelular;
      this.saldoVirtualActualBus = saldoVirtualBus;
    } catch (error: any) {
      await this.ui.showError('Error al cargar datos del cuadre. Verifica tu conexión.');
    } finally {
      this.loading = false;
      this.form.enable();
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

  get mostrarResultadoCelular(): boolean {
    const val = this.form.get('saldoCelularActual')?.value;
    return val !== null && val !== '' && val >= 0;
  }

  get mostrarResultadoBus(): boolean {
    const val = this.form.get('saldoBusActual')?.value;
    return val !== null && val !== '' && val >= 0;
  }

  get mostrarResultado(): boolean {
    return this.mostrarResultadoCelular || this.mostrarResultadoBus;
  }

  cerrar() {
    this.modalCtrl.dismiss();
  }

  limpiar() {
    this.form.reset();
    setTimeout(() => this.saldoCelularInputRef?.nativeElement?.focus(), 50);
  }
}

