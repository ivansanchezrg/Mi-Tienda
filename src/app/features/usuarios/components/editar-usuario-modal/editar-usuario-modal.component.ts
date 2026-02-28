import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonSpinner,
  ModalController, AlertController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, warningOutline } from 'ionicons/icons';
import { UsuarioService } from '../../services/usuario.service';
import { UiService } from '@core/services/ui.service';
import { AuthService } from '../../../auth/services/auth.service';
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

  private modalCtrl      = inject(ModalController);
  private alertCtrl      = inject(AlertController);
  private fb             = inject(FormBuilder);
  private usuarioService = inject(UsuarioService);
  private authService    = inject(AuthService);
  private ui             = inject(UiService);

  guardando = false;

  /** True si el usuario que se edita es el mismo que está logueado */
  esMismoUsuario = false;

  form!: FormGroup;

  constructor() {
    addIcons({ closeOutline, warningOutline });
  }

  async ngOnInit() {
    this.form = this.fb.group({
      nombre: [this.usuario.nombre, [Validators.required, Validators.minLength(2)]],
      rol:    [this.usuario.rol,    Validators.required],
      activo: [this.usuario.activo]
    });

    const actual = await this.authService.getUsuarioActual();
    this.esMismoUsuario = actual?.id === this.usuario.id;
  }

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async confirmar() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const rolNuevo    = this.form.value.rol;
    const activoNuevo = this.form.value.activo;

    // ── 1. AUTO-PROTECCIÓN ──────────────────────────────────────────
    if (this.esMismoUsuario) {
      if (rolNuevo !== 'ADMIN') {
        await this.ui.showError('No podés cambiar tu propio rol a Empleado.');
        return;
      }
      if (!activoNuevo) {
        await this.ui.showError('No podés desactivar tu propia cuenta.');
        return;
      }
    }

    // ── 2. PROTECCIÓN DEL ÚLTIMO ADMIN ──────────────────────────────
    const estaDesactivando = this.usuario.activo && !activoNuevo;
    const estaDegradando   = this.usuario.rol === 'ADMIN' && rolNuevo === 'EMPLEADO';

    if (this.usuario.rol === 'ADMIN' && (estaDesactivando || estaDegradando)) {
      const totalAdmins = await this.usuarioService.contarAdmins();
      if (totalAdmins <= 1) {
        await this.ui.showError('No podés realizar esta acción: es el único administrador del sistema.');
        return;
      }
    }

    // ── 3. CONFIRMACIÓN AL DESACTIVAR ────────────────────────────────
    if (estaDesactivando) {
      const confirmado = await this.pedirConfirmacionDesactivar();
      if (!confirmado) return;
    }

    // ── GUARDAR ──────────────────────────────────────────────────────
    this.guardando = true;
    try {
      const dto: UpdateUsuarioDto = {
        nombre: this.form.value.nombre.trim(),
        rol:    rolNuevo,
        activo: activoNuevo
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

  private pedirConfirmacionDesactivar(): Promise<boolean> {
    return new Promise(async resolve => {
      const alert = await this.alertCtrl.create({
        header: 'Desactivar usuario',
        message: `¿Seguro que querés desactivar a ${this.usuario.nombre}? No podrá ingresar al sistema.`,
        buttons: [
          { text: 'Cancelar',   role: 'cancel',  handler: () => resolve(false) },
          { text: 'Desactivar', role: 'confirm', handler: () => resolve(true)  }
        ]
      });
      await alert.present();
    });
  }
}
