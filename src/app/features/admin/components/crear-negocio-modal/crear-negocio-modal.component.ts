import { Component, inject } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { IonButton, IonIcon, IonSpinner, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { storefrontOutline, closeOutline } from 'ionicons/icons';
import { SupabaseService } from '@core/services/supabase.service';
import { UiService } from '@core/services/ui.service';
import { LoggerService } from '@core/services/logger.service';

export interface NegocioCreado {
  negocio_id: string;
  nombre: string;
}

@Component({
  selector: 'app-crear-negocio-modal',
  templateUrl: './crear-negocio-modal.component.html',
  styleUrls: ['./crear-negocio-modal.component.scss'],
  standalone: true,
  imports: [ReactiveFormsModule, IonButton, IonIcon, IonSpinner]
})
export class CrearNegocioModalComponent {
  private modalCtrl = inject(ModalController);
  private fb        = inject(FormBuilder);
  private supabase  = inject(SupabaseService);
  private ui        = inject(UiService);
  private logger    = inject(LoggerService);

  creando = false;

  form = this.fb.group({
    nombre:       ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    admin_email:  ['', [Validators.required, Validators.email, Validators.maxLength(100)]]
  });

  constructor() {
    addIcons({ storefrontOutline, closeOutline });
  }

  get nombreCtrl()     { return this.form.controls.nombre; }
  get adminEmailCtrl() { return this.form.controls.admin_email; }

  get errorNombre(): string | null {
    const c = this.nombreCtrl;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required'))  return 'Ingresa el nombre del negocio.';
    if (c.hasError('minlength')) return 'Mínimo 2 caracteres.';
    if (c.hasError('maxlength')) return 'Máximo 80 caracteres.';
    return null;
  }

  get errorAdminEmail(): string | null {
    const c = this.adminEmailCtrl;
    if (!c.touched || c.valid) return null;
    if (c.hasError('required')) return 'Ingresa el email del administrador.';
    if (c.hasError('email'))    return 'Email inválido.';
    if (c.hasError('maxlength')) return 'Máximo 100 caracteres.';
    return null;
  }

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async crear() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.creando) return;

    this.creando = true;
    try {
      const nombre      = this.nombreCtrl.value!.trim();
      const adminEmail  = this.adminEmailCtrl.value!.trim().toLowerCase();

      const { data, error } = await this.supabase.client.rpc('fn_crear_negocio', {
        p_nombre_negocio: nombre,
        p_admin_email:    adminEmail,
        p_admin_nombre:   null
      });

      if (error) {
        this.logger.error('CrearNegocioModal', 'Error en fn_crear_negocio', error);
        await this.ui.showError('No se pudo crear el negocio. Intenta de nuevo.');
        return;
      }

      const resultado: NegocioCreado = {
        negocio_id: (data as any).negocio_id,
        nombre
      };

      this.modalCtrl.dismiss(resultado, 'confirm');
    } finally {
      this.creando = false;
    }
  }
}
