import { Component, Input, OnInit, inject } from '@angular/core';
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
import { Usuario, UpdateUsuarioDto } from '../../models/usuario.model';

@Component({
  selector: 'app-editar-usuario-modal',
  templateUrl: './editar-usuario-modal.component.html',
  styleUrls: ['./editar-usuario-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonSpinner
  ]
})
export class EditarUsuarioModalComponent implements OnInit {
  @Input() usuario!: Usuario;

  private modalCtrl = inject(ModalController);
  private fb = inject(FormBuilder);
  private usuarioService = inject(UsuarioService);
  private ui = inject(UiService);

  guardando = false;

  form!: FormGroup;

  constructor() {
    addIcons({ closeOutline });
  }

  ngOnInit() {
    this.form = this.fb.group({
      nombre: [this.usuario.nombre, [Validators.required, Validators.minLength(2)]],
      rol: [this.usuario.rol, Validators.required],
      activo: [this.usuario.activo]
    });
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
      const dto: UpdateUsuarioDto = {
        nombre: this.form.value.nombre.trim(),
        rol: this.form.value.rol,
        activo: this.form.value.activo
      };

      const updated = await this.usuarioService.update(this.usuario.id, dto);
      if (!updated) {
        await this.ui.showError('No se pudo actualizar el usuario.');
        return;
      }

      this.modalCtrl.dismiss(updated, 'confirm');
    } catch {
      await this.ui.showError('Error al actualizar el usuario. Verificá tu conexión.');
    } finally {
      this.guardando = false;
    }
  }
}
