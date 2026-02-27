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
    usuario: ['', [Validators.required, Validators.email]],
    rol: ['EMPLEADO', Validators.required]
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
        usuario: this.form.value.usuario.trim(),
        rol: this.form.value.rol
      };

      const created = await this.usuarioService.create(dto);
      if (!created) {
        await this.ui.showError('No se pudo registrar el usuario.');
        return;
      }

      this.modalCtrl.dismiss(created, 'confirm');
    } catch {
      await this.ui.showError('Error al registrar el usuario. Verificá tu conexión.');
    } finally {
      this.guardando = false;
    }
  }
}
