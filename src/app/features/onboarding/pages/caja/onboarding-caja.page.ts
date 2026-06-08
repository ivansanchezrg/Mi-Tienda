import { Component, inject } from '@angular/core';
import { FormBuilder, Validators, AbstractControl, ValidationErrors, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonContent, IonButton, IonIcon, IonSpinner, IonProgressBar
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  walletOutline, arrowForwardOutline, arrowBackOutline,
  shieldCheckmarkOutline, peopleOutline, checkmarkCircle
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { OnboardingService } from '../../services/onboarding.service';
import { ROUTES } from '@core/config/routes.config';

function variosMontoValidator(control: AbstractControl): ValidationErrors | null {
  const variosActiva = control.get('variosActiva')?.value;
  const montoVarios  = control.get('montoVarios')?.value;
  if (variosActiva && (montoVarios === null || montoVarios === undefined || Number(montoVarios) <= 0)) {
    return { variosMontoRequerido: true };
  }
  return null;
}

@Component({
  selector: 'app-onboarding-caja',
  templateUrl: './onboarding-caja.page.html',
  styleUrls: ['./onboarding-caja.page.scss'],
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule,
    IonContent, IonButton, IonIcon, IonSpinner, IonProgressBar
  ]
})
export class OnboardingCajaPage {
  private fb                = inject(FormBuilder);
  private router            = inject(Router);
  private ui                = inject(UiService);
  private onboardingService = inject(OnboardingService);

  guardando = false;

  form = this.fb.group({
    variosActiva:     [false],
    montoVarios:      [null as number | null, [Validators.min(0.01)]],
    nominaSueldoBase: [null as number | null, [Validators.required, Validators.min(0)]]
  }, { validators: variosMontoValidator });

  constructor() {
    addIcons({ walletOutline, arrowForwardOutline, arrowBackOutline, shieldCheckmarkOutline, peopleOutline, checkmarkCircle });
    // Restaurar borrador si el usuario volvió
    const d = this.onboardingService.draft;
    if (d.variosActiva     !== undefined) this.form.patchValue({ variosActiva: d.variosActiva });
    if (d.montoVarios      !== undefined) this.form.patchValue({ montoVarios: d.montoVarios });
    if (d.nominaSueldoBase !== undefined) this.form.patchValue({ nominaSueldoBase: d.nominaSueldoBase });
  }

  get usaVarios(): boolean { return !!this.form.value.variosActiva; }

  setVarios(value: boolean) {
    this.form.patchValue({ variosActiva: value });
    if (!value) this.form.patchValue({ montoVarios: null });
  }
  get variosMontoError(): boolean {
    return this.form.hasError('variosMontoRequerido') && this.form.touched;
  }

  /** Navega al paso 1 segun la ruta base actual (mantiene el modo del wizard). */
  volver() {
    const ruta = this.onboardingService.mode === 'inicial'
      ? ROUTES.onboarding.contexto
      : ROUTES.crearNegocio.contexto;
    this.router.navigate([ruta], { replaceUrl: true });
  }

  async continuar() {
    if (this.guardando) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const variosActiva = !!this.form.value.variosActiva;
    const montoVarios  = variosActiva ? Number(this.form.value.montoVarios) : 0;

    this.onboardingService.guardarPaso2({
      variosActiva,
      montoVarios,
      nominaSueldoBase: Number(this.form.value.nominaSueldoBase ?? 0)
    });

    this.guardando = true;
    await this.ui.showLoading('Creando el negocio...');

    try {
      const negocioId = await this.onboardingService.completar();
      if (!negocioId) {
        await this.ui.showError('No se pudo crear el negocio. Verifica los datos e intenta de nuevo.');
        return;
      }

      // Comportamiento post-creacion segun modo
      const mode = this.onboardingService.mode;

      if (mode === 'inicial') {
        // Onboarding: activa JWT y va a /home
        const ok = await this.onboardingService.activarYFinalizar(negocioId);
        if (!ok) {
          await this.ui.showError('Negocio creado pero no se pudo activar la sesión. Cierra sesión e ingresa de nuevo.');
        }
      } else {
        // Sucursal: NO activa el JWT del nuevo negocio
        await this.ui.hideLoading();
        await this.ui.showSuccess('Negocio creado correctamente.');
        this.onboardingService.reset();
        // Vuelve al lugar correcto segun el modo
        const destino = mode === 'sucursal-superadmin' ? ROUTES.admin : ROUTES.home;
        this.router.navigate([destino], { replaceUrl: true });
      }
    } finally {
      // Para 'inicial' showLoading ya se cerro al activar el JWT (cambio de pagina).
      // Para sucursal-* tambien se cerro arriba. Doble hideLoading es seguro.
      await this.ui.hideLoading();
      this.guardando = false;
    }
  }
}
