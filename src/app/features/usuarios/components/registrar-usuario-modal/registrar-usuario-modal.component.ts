import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonSpinner,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import { UsuarioService } from '../../services/usuario.service';
import { UiService } from '@core/services/ui.service';
import { CreateUsuarioDto } from '../../models/usuario.model';

@Component({
  selector: 'app-registrar-usuario-modal',
  templateUrl: './registrar-usuario-modal.component.html',
  styleUrls: ['./registrar-usuario-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonSpinner
  ]
})
export class RegistrarUsuarioModalComponent {
  private modalCtrl = inject(ModalController);
  private fb = inject(FormBuilder);
  private usuarioService = inject(UsuarioService);
  private ui = inject(UiService);

  guardando = false;

  form: FormGroup = this.fb.group({
    nombre: ['', [Validators.required, Validators.minLength(2)]],
    email:  ['', [Validators.required, Validators.email]],
    rol:    ['EMPLEADO', Validators.required]
  });

  constructor() {
    addIcons({ closeOutline });
  }

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async confirmar() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.guardando = true;
    try {
      const dto: CreateUsuarioDto = {
        nombre: this.form.value.nombre.trim(),
        email:  this.form.value.email.trim(),
        rol:    this.form.value.rol
      };

      const created = await this.usuarioService.create(dto);
      this.modalCtrl.dismiss(created, 'confirm');
    } catch (err: any) {
      const mensaje = this.traducirError(err?.message ?? '');
      await this.ui.showError(mensaje);
    } finally {
      this.guardando = false;
    }
  }

  /**
   * Mapea mensajes tecnicos del backend a textos amigables para el usuario final.
   * Si el mensaje no es conocido, retorna uno generico (no expone detalles internos).
   */
  private traducirError(raw: string): string {
    const email = (this.form.value.email ?? '').trim();

    if (/ya pertenece al negocio/i.test(raw)) {
      return `${email} ya forma parte de este negocio. Si lo desactivaste antes, podés reactivarlo desde la lista.`;
    }

    if (/no existe en el sistema/i.test(raw)) {
      return `El usuario ${email} aun no se registro. Pedile que inicie sesion una vez con su Google para crear su cuenta y volve a intentarlo.`;
    }

    if (/Solo los administradores/i.test(raw)) {
      return 'Solo un administrador puede registrar usuarios.';
    }

    if (/email es obligatorio|email invalido/i.test(raw)) {
      return 'Ingresa un email valido.';
    }

    if (/No hay negocio activo/i.test(raw)) {
      return 'No se detecto un negocio activo. Cerra sesion e ingresa de nuevo.';
    }

    // Cualquier otro error: mensaje generico que no expone SQL ni stacks.
    return 'No se pudo registrar el usuario. Verifica los datos e intenta de nuevo.';
  }
}
