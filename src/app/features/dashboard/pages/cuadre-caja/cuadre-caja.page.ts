import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonCard, IonInput, IonTextarea,
  AlertController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chevronBackOutline, cashOutline, checkmarkCircleOutline,
  warningOutline, alertCircleOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { CajasService, Caja } from '../../services/cajas.service';
import { AuthService } from '../../../auth/services/auth.service';

@Component({
  selector: 'app-cuadre-caja',
  templateUrl: './cuadre-caja.page.html',
  styleUrls: ['./cuadre-caja.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonCard, IonInput, IonTextarea
  ]
})
export class CuadreCajaPage implements OnInit {
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private ui = inject(UiService);
  private cajasService = inject(CajasService);
  private authService = inject(AuthService);
  private alertCtrl = inject(AlertController);

  form!: FormGroup;
  caja: Caja | null = null;
  saldoSistema: number = 0;
  loading = true;

  constructor() {
    addIcons({
      chevronBackOutline, cashOutline, checkmarkCircleOutline,
      warningOutline, alertCircleOutline
    });
  }

  async ngOnInit() {
    this.form = this.fb.group({
      efectivoContado: [null, [Validators.required, Validators.min(0)]],
      observaciones: ['']
    });

    await this.cargarDatosCaja();
  }

  ionViewWillEnter() {
    this.ui.hideTabs();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  async cargarDatosCaja() {
    this.loading = true;
    try {
      // Por ahora solo cuadre de CAJA principal (id: 1)
      this.caja = await this.cajasService.obtenerCajaPorId(1);
      if (this.caja) {
        this.saldoSistema = this.caja.saldo_actual;
      }
    } catch (error) {
      console.error('Error al cargar caja:', error);
      await this.ui.showError('Error al cargar datos de la caja');
    } finally {
      this.loading = false;
    }
  }

  get efectivoContado(): number {
    return this.form.get('efectivoContado')?.value || 0;
  }

  get diferencia(): number {
    return this.efectivoContado - this.saldoSistema;
  }

  get diferenciaAbsoluta(): number {
    return Math.abs(this.diferencia);
  }

  get estadoCuadre(): 'cuadrado' | 'sobrante' | 'faltante' {
    if (this.diferencia === 0) return 'cuadrado';
    if (this.diferencia > 0) return 'sobrante';
    return 'faltante';
  }

  get colorEstado(): string {
    switch (this.estadoCuadre) {
      case 'cuadrado': return 'success';
      case 'sobrante': return 'warning';
      case 'faltante': return 'danger';
    }
  }

  get iconoEstado(): string {
    switch (this.estadoCuadre) {
      case 'cuadrado': return 'checkmark-circle-outline';
      case 'sobrante': return 'warning-outline';
      case 'faltante': return 'alert-circle-outline';
    }
  }

  get textoEstado(): string {
    switch (this.estadoCuadre) {
      case 'cuadrado': return 'Caja cuadrada';
      case 'sobrante': return 'Sobrante de efectivo';
      case 'faltante': return 'Faltante de efectivo';
    }
  }

  get requiereObservaciones(): boolean {
    return this.diferencia !== 0;
  }

  get formularioValido(): boolean {
    if (this.form.invalid) return false;
    if (this.requiereObservaciones && !this.form.get('observaciones')?.value?.trim()) {
      return false;
    }
    return true;
  }

  volver() {
    this.router.navigate(['/home']);
  }

  async confirmarCuadre() {
    if (!this.formularioValido) {
      this.form.markAllAsTouched();
      if (this.requiereObservaciones && !this.form.get('observaciones')?.value?.trim()) {
        await this.ui.showToast('Las observaciones son requeridas cuando hay diferencia', 'warning');
      }
      return;
    }

    // Si hay diferencia, pedir confirmación
    if (this.diferencia !== 0) {
      const alert = await this.alertCtrl.create({
        header: 'Confirmar Ajuste',
        message: `Se registrará un ${this.estadoCuadre === 'sobrante' ? 'ingreso' : 'egreso'} de $${this.diferenciaAbsoluta.toFixed(2)} para cuadrar la caja. ¿Continuar?`,
        buttons: [
          {
            text: 'Cancelar',
            role: 'cancel'
          },
          {
            text: 'Confirmar',
            role: 'confirm',
            handler: () => this.ejecutarCuadre()
          }
        ]
      });
      await alert.present();
    } else {
      await this.ejecutarCuadre();
    }
  }

  private async ejecutarCuadre() {
    await this.ui.showLoading('Registrando cuadre...');

    try {
      const empleado = await this.authService.getEmpleadoActual();
      if (!empleado) {
        throw new Error('No se pudo obtener el empleado actual');
      }

      // Si hay diferencia, crear operación de ajuste
      if (this.diferencia !== 0) {
        const tipoOperacion = this.diferencia > 0 ? 'INGRESO' : 'EGRESO';
        const descripcion = `Ajuste por cuadre: ${this.form.get('observaciones')?.value || 'Sin observaciones'}`;

        await this.cajasService.registrarOperacion({
          cajaId: 1, // CAJA principal
          empleadoId: empleado.id,
          tipo: tipoOperacion,
          monto: this.diferenciaAbsoluta,
          descripcion: descripcion
        });
      }

      await this.ui.hideLoading();

      if (this.diferencia === 0) {
        await this.ui.showSuccess('Cuadre verificado correctamente');
      } else {
        await this.ui.showSuccess('Cuadre registrado con ajuste');
      }

      // Volver al home
      await this.router.navigate(['/home'], {
        queryParams: { refresh: Date.now() }
      });
    } catch (error: any) {
      await this.ui.hideLoading();
      await this.ui.showError(error.message || 'Error al registrar el cuadre');
    }
  }
}
