import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, Validators, AbstractControl, ValidationErrors, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonContent, IonButton, IonIcon, IonProgressBar
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  walletOutline, arrowForwardOutline, arrowBackOutline,
  shieldCheckmarkOutline, checkmarkCircle
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { CurrencyService } from '@core/services/currency.service';
import { OnboardingService, OnboardingNegocioError } from '../../services/onboarding.service';
import { ROUTES } from '@core/config/routes.config';

function variosMontoValidator(control: AbstractControl): ValidationErrors | null {
  const variosActiva = control.get('variosActiva')?.value;
  const montoVarios  = control.get('montoVarios')?.value;
  // Normaliza coma decimal → punto antes de Number() (el input es type="text").
  const num = Number(String(montoVarios ?? '').replace(',', '.'));
  if (variosActiva && (montoVarios === null || montoVarios === undefined || montoVarios === '' || isNaN(num) || num <= 0)) {
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
    IonContent, IonButton, IonIcon, IonProgressBar
  ]
})
export class OnboardingCajaPage implements OnInit {
  private fb                = inject(FormBuilder);
  private router            = inject(Router);
  private ui                = inject(UiService);
  private onboardingService = inject(OnboardingService);
  private currency          = inject(CurrencyService);

  guardando = false;

  // El sueldo base NO se pide aquí (fricción de captación) — fn_completar_onboarding
  // recibe 0 y el admin lo configura en Parámetros cuando contrate empleados.
  form = this.fb.group({
    variosActiva: [false],
    montoVarios:  [null as number | null, [Validators.min(0.01)]],
  }, { validators: variosMontoValidator });

  constructor() {
    addIcons({ walletOutline, arrowForwardOutline, arrowBackOutline, shieldCheckmarkOutline, checkmarkCircle });
    // Restaurar borrador si el usuario volvió
    const d = this.onboardingService.draft;
    if (d.variosActiva !== undefined) this.form.patchValue({ variosActiva: d.variosActiva });
    if (d.montoVarios  !== undefined) this.form.patchValue({ montoVarios: d.montoVarios });
  }

  ngOnInit() {
    // El draft vive solo en memoria: si el usuario recarga en este paso, el nombre
    // del negocio se perdió y completar() fallaría sin salida. Volver al paso 1.
    if (!this.onboardingService.draft.nombre) {
      const paso1 = this.router.url.includes('/crear-negocio')
        ? ROUTES.crearNegocio.negocio
        : ROUTES.onboarding.negocio;
      this.router.navigate([paso1], { replaceUrl: true });
    }
  }

  /** Nombre del paso 1 — mantiene el hilo narrativo hasta el cierre del wizard. */
  get nombreNegocio(): string {
    return this.onboardingService.draft.nombre || 'Tu negocio';
  }

  /** Pasos del wizard: inicial tiene 3 (incluye la pantalla educativa), sucursal 2. */
  get progressLabel(): string {
    return this.onboardingService.mode === 'inicial' ? 'Paso 3 de 3' : 'Paso 2 de 2';
  }

  /** CTA con sentido de entrega según el modo — "Finalizar" cierra un trámite, esto entrega algo. */
  get textoBotonFinal(): string {
    if (this.onboardingService.mode === 'inicial') return 'Crear mi negocio';
    if (this.onboardingService.mode === 'sucursal-admin') return 'Crear sucursal';
    return 'Crear negocio';
  }

  get usaVarios(): boolean { return !!this.form.value.variosActiva; }

  setVarios(value: boolean) {
    this.form.patchValue({ variosActiva: value });
    if (!value) this.form.patchValue({ montoVarios: null });
  }
  get variosMontoError(): boolean {
    return this.form.hasError('variosMontoRequerido') && this.form.touched;
  }

  /** Navega al paso anterior según el modo — en sucursal la pantalla educativa se salta. */
  volver() {
    const ruta = this.onboardingService.mode === 'inicial'
      ? ROUTES.onboarding.contexto
      : ROUTES.crearNegocio.negocio;
    this.router.navigate([ruta], { replaceUrl: true });
  }

  async continuar() {
    if (this.guardando) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const variosActiva = !!this.form.value.variosActiva;
    // parse(): el input es type="text" (posible coma decimal). Número real al backend.
    const montoVarios  = variosActiva ? this.currency.parse(this.form.value.montoVarios) : 0;

    this.onboardingService.guardarPaso2({
      variosActiva,
      montoVarios,
      nominaSueldoBase: 0
    });

    // Capturar el nombre ANTES de completar — activarYFinalizar() limpia el draft.
    const nombreNegocio = this.onboardingService.draft.nombre ?? '';

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
        } else {
          // Momento de celebración — el usuario aterriza en su negocio recién creado
          await this.ui.showSuccess(`¡${nombreNegocio} está listo! 🎉`);
        }
      } else {
        // Sucursal: NO activa el JWT del nuevo negocio
        await this.ui.hideLoading();
        await this.ui.showSuccess('Negocio creado correctamente.');
        this.onboardingService.reset();
        // Vuelve al lugar correcto segun el modo
        const destino = mode === 'sucursal-superadmin' ? ROUTES.admin.root : ROUTES.home;
        this.router.navigate([destino], { replaceUrl: true });
      }
    } catch (err) {
      // Límite de sucursales del plan (u otro error de negocio): mostrar el mensaje tal cual.
      if (err instanceof OnboardingNegocioError) {
        await this.ui.hideLoading();
        await this.ui.showError(err.message);
      } else {
        throw err;
      }
    } finally {
      // Para 'inicial' showLoading ya se cerro al activar el JWT (cambio de pagina).
      // Para sucursal-* tambien se cerro arriba. Doble hideLoading es seguro.
      await this.ui.hideLoading();
      this.guardando = false;
    }
  }
}
