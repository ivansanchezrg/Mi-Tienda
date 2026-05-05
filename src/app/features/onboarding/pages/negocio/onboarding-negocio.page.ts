import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonContent, IonButton, IonIcon, IonProgressBar, IonSpinner
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  storefrontOutline, arrowForwardOutline, logOutOutline, arrowBackOutline,
  checkmarkCircle, personAddOutline, searchOutline
} from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../auth/services/auth.service';
import { OnboardingService, OnboardingMode, NegocioResumen } from '../../services/onboarding.service';
import { ROUTES } from '@core/config/routes.config';

/**
 * Estado de verificacion del email del admin (solo en modo sucursal-superadmin).
 *
 * - 'pendiente'   → Email vacio, invalido, o aun no verificado contra BD.
 *                   El usuario debe terminar de escribir y validar antes de continuar.
 * - 'verificando' → Llamada en vuelo a fn_consultar_usuario_por_email.
 * - 'existe'      → Email ya registrado en `usuarios`. Reusamos ese registro.
 *                   Se muestra el nombre real, el campo "Nombre del admin" se oculta.
 * - 'nuevo'       → Email no existe. Se creara un usuario nuevo.
 *                   Campo "Nombre del admin" se vuelve obligatorio.
 * - 'error'       → Fallo la consulta. Permitimos continuar con la lógica vieja
 *                   (la funcion SQL fn_completar_onboarding maneja ambos casos).
 */
type VerificacionEmail = 'pendiente' | 'verificando' | 'existe' | 'nuevo' | 'error';

@Component({
  selector: 'app-onboarding-negocio',
  templateUrl: './onboarding-negocio.page.html',
  styleUrls: ['./onboarding-negocio.page.scss'],
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule,
    IonContent, IonButton, IonIcon, IonProgressBar, IonSpinner
  ]
})
export class OnboardingNegocioPage implements OnInit, OnDestroy {
  private fb                = inject(FormBuilder);
  private router            = inject(Router);
  private route             = inject(ActivatedRoute);
  private authService       = inject(AuthService);
  private onboardingService = inject(OnboardingService);

  // Detectado en ngOnInit segun la ruta y query params
  mode: OnboardingMode = 'inicial';

  // Form base — campos extra (adminEmail, adminNombre) solo si mode === 'sucursal-superadmin'
  form = this.fb.group({
    nombre:       ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    telefono:     ['', [Validators.maxLength(20)]],
    direccion:    ['', [Validators.maxLength(200)]],
    adminEmail:   ['', [Validators.email, Validators.maxLength(100)]],
    adminNombre:  ['', [Validators.maxLength(100)]],
  });

  // Estado de verificacion del email (solo aplica en modo sucursal-superadmin)
  verificacion: VerificacionEmail = 'pendiente';
  /** Nombre encontrado en BD si verificacion === 'existe'. Se muestra como readonly. */
  nombreEncontrado: string | null = null;
  /** Lista de negocios donde el usuario ya tiene membresia activa. */
  negociosExistentes: NegocioResumen[] = [];

  private emailSub?: Subscription;

  constructor() {
    addIcons({
      storefrontOutline, arrowForwardOutline, logOutOutline, arrowBackOutline,
      checkmarkCircle, personAddOutline, searchOutline
    });
  }

  async ngOnInit() {
    this.mode = await this.resolverMode();
    this.onboardingService.setMode(this.mode);

    // Validators dinamicos para mode = sucursal-superadmin
    if (this.mode === 'sucursal-superadmin') {
      this.form.controls.adminEmail.addValidators([Validators.required]);
      this.form.controls.adminEmail.updateValueAndValidity();

      // Resetear estado de verificacion al cambiar el email manualmente
      this.emailSub = this.form.controls.adminEmail.valueChanges.subscribe(() => {
        if (this.verificacion !== 'pendiente') {
          this.verificacion = 'pendiente';
          this.nombreEncontrado = null;
          this.negociosExistentes = [];
          this.form.controls.adminNombre.setValue('', { emitEvent: false });
        }
      });
    }

    // Restaurar draft si volvemos del paso 2
    const d = this.onboardingService.draft;
    if (d.nombre)       this.form.patchValue({ nombre: d.nombre });
    if (d.telefono)     this.form.patchValue({ telefono: d.telefono });
    if (d.direccion)    this.form.patchValue({ direccion: d.direccion });
    if (d.adminEmail)   this.form.patchValue({ adminEmail: d.adminEmail });
    if (d.adminNombre)  this.form.patchValue({ adminNombre: d.adminNombre });

    // Si volvemos del paso 2 con email guardado, re-validar para reconstruir UI
    if (this.mode === 'sucursal-superadmin' && d.adminEmail) {
      await this.verificarEmail();
    }
  }

  ngOnDestroy() {
    this.emailSub?.unsubscribe();
  }

  /**
   * Resuelve el modo del wizard segun:
   * - URL base (/onboarding vs /crear-negocio)
   * - Query param ?context= (admin | sucursal)
   * - Rol del usuario logueado (es_superadmin)
   */
  private async resolverMode(): Promise<OnboardingMode> {
    const url = this.router.url;
    const esCrearNegocio = url.includes('/crear-negocio');

    if (!esCrearNegocio) {
      return 'inicial'; // ruta /onboarding
    }

    const context = this.route.snapshot.queryParamMap.get('context');
    const usuario = await this.authService.getUsuarioActual();
    const esSuperadmin = usuario?.es_superadmin ?? false;

    // context=admin solo lo abre el superadmin desde /admin
    if (context === 'admin') {
      return 'sucursal-superadmin';
    }

    // context=sucursal: el modo depende del rol
    return esSuperadmin ? 'sucursal-superadmin' : 'sucursal-admin';
  }

  get nombreCtrl()      { return this.form.controls.nombre; }
  get adminEmailCtrl()  { return this.form.controls.adminEmail; }
  get adminNombreCtrl() { return this.form.controls.adminNombre; }

  get esModoSuperadmin(): boolean {
    return this.mode === 'sucursal-superadmin';
  }

  get tituloPagina(): string {
    if (this.mode === 'inicial')         return '¡Bienvenido!';
    if (this.mode === 'sucursal-admin')  return 'Nueva sucursal';
    return 'Crear negocio';
  }

  get subtitulo(): string {
    if (this.mode === 'inicial')         return 'Primero, contanos cómo se llama tu negocio.';
    if (this.mode === 'sucursal-admin')  return 'Configurá los datos de tu nueva sucursal.';
    return 'Datos del negocio y del administrador que lo gestionará.';
  }

  get textoBotonContinuar(): string {
    return 'Continuar';
  }

  get errorNombre(): string | null {
    const c = this.nombreCtrl;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required'))  return 'Ingresá el nombre del negocio.';
    if (c.hasError('minlength')) return 'Mínimo 2 caracteres.';
    if (c.hasError('maxlength')) return 'Máximo 80 caracteres.';
    return null;
  }

  get errorAdminEmail(): string | null {
    const c = this.adminEmailCtrl;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required'))  return 'Ingresá el email del administrador.';
    if (c.hasError('email'))     return 'Email inválido.';
    if (c.hasError('maxlength')) return 'Máximo 100 caracteres.';
    return null;
  }

  /**
   * Habilita/deshabilita el boton Continuar segun el estado del wizard.
   * En modo superadmin: requiere verificacion completa antes de avanzar.
   */
  get puedeContinuar(): boolean {
    if (this.form.controls.nombre.invalid) return false;

    if (this.mode === 'sucursal-superadmin') {
      // Email valido + verificacion exitosa
      if (this.adminEmailCtrl.invalid) return false;
      if (this.verificacion === 'pendiente' || this.verificacion === 'verificando') return false;
      // Si es nuevo, el nombre del admin es obligatorio
      if (this.verificacion === 'nuevo') {
        const nombre = (this.adminNombreCtrl.value ?? '').trim();
        if (nombre.length < 2) return false;
      }
    }

    return true;
  }

  /**
   * Llamado al perder foco del input de email (o al volver del paso 2 con un email guardado).
   * Llama al RPC y actualiza el estado de verificacion.
   */
  async verificarEmail() {
    const email = (this.adminEmailCtrl.value ?? '').trim();

    // Solo verificar si el formato es valido
    if (!email || this.adminEmailCtrl.hasError('email')) {
      this.verificacion = 'pendiente';
      this.nombreEncontrado = null;
      this.negociosExistentes = [];
      return;
    }

    this.verificacion = 'verificando';
    this.nombreEncontrado = null;
    this.negociosExistentes = [];

    const resultado = await this.onboardingService.verificarEmailAdmin(email);

    if (resultado === null) {
      this.verificacion = 'error';
      return;
    }

    if (resultado.existe) {
      this.verificacion = 'existe';
      this.nombreEncontrado = resultado.nombre;
      this.negociosExistentes = resultado.negocios;
      // Setear el nombre en el form (aunque el campo este oculto, lo necesitamos para el draft)
      this.adminNombreCtrl.setValue(resultado.nombre ?? '', { emitEvent: false });
    } else {
      this.verificacion = 'nuevo';
      this.nombreEncontrado = null;
      this.negociosExistentes = [];
      this.adminNombreCtrl.setValue('', { emitEvent: false });
    }
  }

  /** Etiqueta corta para mostrar el rol/relacion del usuario con un negocio */
  rolLabel(n: NegocioResumen): string {
    if (n.es_propietario) return 'Propietario';
    return n.rol === 'ADMIN' ? 'Administrador' : 'Empleado';
  }

  continuar() {
    this.form.markAllAsTouched();
    if (!this.puedeContinuar) return;

    this.onboardingService.guardarPaso1({
      nombre:       this.form.value.nombre!.trim(),
      telefono:     this.form.value.telefono?.trim() ?? '',
      direccion:    this.form.value.direccion?.trim() ?? '',
      adminEmail:   this.form.value.adminEmail?.trim() ?? '',
      adminNombre:  this.form.value.adminNombre?.trim() ?? '',
      // En modo sucursal-superadmin el propietario es el mismo admin (mismo dueño solicitando sucursal).
      propietarioEmail: this.form.value.adminEmail?.trim() ?? '',
    });

    const siguienteRuta = this.mode === 'inicial'
      ? ROUTES.onboarding.caja
      : ROUTES.crearNegocio.caja;

    this.router.navigate([siguienteRuta], { replaceUrl: true });
  }

  /** Solo en mode = 'inicial' tiene sentido cerrar sesion. En los otros modos volvemos atras. */
  async accionAtras() {
    if (this.mode === 'inicial') {
      await this.authService.logoutSilent();
    } else if (this.mode === 'sucursal-superadmin' && this.router.url.includes('/crear-negocio') && this.route.snapshot.queryParamMap.get('context') === 'admin') {
      this.router.navigate([ROUTES.admin]);
    } else {
      this.router.navigate([ROUTES.home]);
    }
  }

  get textoBotonAtras(): string {
    return this.mode === 'inicial' ? 'Cerrar sesión' : 'Cancelar';
  }

  get iconoBotonAtras(): string {
    return this.mode === 'inicial' ? 'log-out-outline' : 'arrow-back-outline';
  }
}
