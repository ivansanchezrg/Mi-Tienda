import { Component, inject } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonContent, IonButton, IonIcon, IonSpinner
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { storefront, logOutOutline, arrowForwardOutline } from 'ionicons/icons';
import { AuthService } from '../../services/auth.service';
import { UiService } from '@core/services/ui.service';
import { SupabaseService } from '@core/services/supabase.service';
import { LoggerService } from '@core/services/logger.service';

@Component({
  selector: 'app-crear-negocio',
  templateUrl: './crear-negocio.page.html',
  styleUrls: ['./crear-negocio.page.scss'],
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IonContent, IonButton, IonIcon, IonSpinner
  ]
})
export class CrearNegocioPage {
  private fb        = inject(FormBuilder);
  private auth      = inject(AuthService);
  private ui        = inject(UiService);
  private supabase  = inject(SupabaseService);
  private logger    = inject(LoggerService);

  creando = false;

  form = this.fb.group({
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]]
  });

  constructor() {
    addIcons({ storefront, logOutOutline, arrowForwardOutline });
  }

  get nombreCtrl() { return this.form.controls.nombre; }

  get errorNombre(): string | null {
    const c = this.nombreCtrl;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required'))   return 'Ingresa el nombre de tu negocio.';
    if (c.hasError('minlength'))  return 'Mínimo 2 caracteres.';
    if (c.hasError('maxlength'))  return 'Máximo 80 caracteres.';
    return null;
  }

  async crear() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.creando) return;

    this.creando = true;

    try {
      const nombre = this.nombreCtrl.value!.trim();
      const user   = await this.auth.getUser();

      if (!user?.email) {
        await this.ui.showError('No se pudo obtener tu sesión. Inicia sesión nuevamente.');
        await this.auth.logoutSilent();
        return;
      }

      // 1. Crear el negocio con todos sus datos semilla
      const { data, error } = await this.supabase.client
        .rpc('fn_crear_negocio', {
          p_nombre_negocio: nombre,
          p_admin_email:    user.email,
          p_admin_nombre:   user.user_metadata?.['full_name'] ?? user.user_metadata?.['name'] ?? null
        });

      if (error) {
        this.logger.error('CrearNegocioPage', 'Error en fn_crear_negocio', error);
        await this.ui.showError('No se pudo crear el negocio. Intenta de nuevo.');
        return;
      }

      const negocioId: string = (data as any).negocio_id;

      // 2. Activar el negocio en el JWT
      const { error: activarError } = await this.supabase.client
        .rpc('fn_set_negocio_activo', { p_negocio_id: negocioId });

      if (activarError) {
        this.logger.error('CrearNegocioPage', 'Error en fn_set_negocio_activo', activarError);
        await this.ui.showError('Negocio creado pero no se pudo activar. Inicia sesión nuevamente.');
        await this.auth.logoutSilent();
        return;
      }

      // 3. Refrescar sesión para que el JWT incluya negocio_id + rol
      const { error: refreshError } = await this.supabase.client.auth.refreshSession();
      if (refreshError) {
        this.logger.error('CrearNegocioPage', 'Error al refrescar sesión', refreshError);
        await this.ui.showError('Error al actualizar tu sesión. Inicia sesión nuevamente.');
        await this.auth.logoutSilent();
        return;
      }

      // 4. Re-ejecutar validarUsuario para que el AuthService construya
      //    el UsuarioActual completo y navegue a /home
      await this.auth.validarUsuario();

    } finally {
      this.creando = false;
    }
  }

  async salir() {
    await this.auth.logoutSilent();
  }
}
