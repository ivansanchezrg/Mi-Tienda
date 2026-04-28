import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonSpinner, IonSkeletonText,
  ModalController, AlertController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, warningOutline, shieldCheckmarkOutline, swapHorizontalOutline, chevronForwardOutline, pauseCircleOutline } from 'ionicons/icons';
import { UsuarioService } from '../../services/usuario.service';
import { UiService } from '@core/services/ui.service';
import { AuthService } from '../../../auth/services/auth.service';
import { NegocioService } from '../../../auth/services/negocio.service';
import { NegocioDisponible } from '../../../auth/services/auth.service';
import { SupabaseService } from '@core/services/supabase.service';
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
    IonContent, IonIcon, IonSpinner, IonSkeletonText
  ]
})
export class EditarUsuarioModalComponent implements OnInit {
  @Input() usuario!: Usuario;

  private modalCtrl      = inject(ModalController);
  private alertCtrl      = inject(AlertController);
  private fb             = inject(FormBuilder);
  private usuarioService = inject(UsuarioService);
  private authService    = inject(AuthService);
  private negocioService = inject(NegocioService);
  private supabase       = inject(SupabaseService);
  private ui             = inject(UiService);

  guardando     = false;
  transfiriendo = false;
  loadingNegocios = false;

  /** True si el usuario que se edita es el mismo que está logueado */
  esMismoUsuario = false;

  /** True si el usuario que se edita es el superadmin (protegido, no editable en rol/activo) */
  esSuperadmin = false;

  /**
   * Nombre del negocio donde el empleado está activo actualmente.
   * Solo se carga si el empleado está inactivo en este negocio.
   * - null  → aún cargando (o no aplica)
   * - ''    → inactivo sin membresía activa en ningún otro negocio (desactivado manualmente)
   * - 'X'   → activo en el negocio "X", no puede reactivarse aquí
   */
  negocioActivoEmpleado: string | null = null;

  /** Negocios disponibles para transferir (vacío si no aplica) */
  misNegocios: NegocioDisponible[] = [];

  form!: FormGroup;

  constructor() {
    addIcons({ closeOutline, warningOutline, shieldCheckmarkOutline, swapHorizontalOutline, chevronForwardOutline, pauseCircleOutline });
  }

  async ngOnInit() {
    this.form = this.fb.group({
      nombre: [this.usuario.nombre, [Validators.required, Validators.minLength(2)]],
      rol:    [this.usuario.rol,    Validators.required],
      activo: [this.usuario.activo]
    });

    const actual = await this.authService.getUsuarioActual();
    this.esMismoUsuario = actual?.id === this.usuario.id;
    this.esSuperadmin = this.usuario.es_superadmin === true;

    // Superadmin o mismo usuario: deshabilitar campos de rol y estado (solo se puede editar el nombre)
    if (this.esSuperadmin || this.esMismoUsuario) {
      this.form.get('rol')?.disable();
      this.form.get('activo')?.disable();
    }

    const esEmpleadoEditable = !this.esMismoUsuario && !this.esSuperadmin && this.usuario.rol !== 'ADMIN';

    if (esEmpleadoEditable && this.usuario.activo) {
      // Activo: cargar negocios destino para transferencia
      this.loadingNegocios = true;
      try {
        const { data: { user } } = await this.supabase.client.auth.getUser();
        const negocioActivoId = user?.app_metadata?.['negocio_id'] as string | undefined;
        const todos = await this.negocioService.getMisNegocios();
        this.misNegocios = todos.filter(n => n.negocio_id !== negocioActivoId);
      } finally {
        this.loadingNegocios = false;
      }
    } else if (esEmpleadoEditable && !this.usuario.activo) {
      // Inactivo: verificar si tiene membresía activa en otro negocio
      const { data } = await this.supabase.client
        .from('usuario_negocios')
        .select('negocio:negocios(nombre)')
        .eq('usuario_id', this.usuario.id)
        .eq('activo', true)
        .limit(1)
        .maybeSingle();

      this.negocioActivoEmpleado = (data as any)?.negocio?.nombre ?? '';
    }
  }

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async transferir(negocio: NegocioDisponible) {
    const confirmado = await new Promise<boolean>(async resolve => {
      const alert = await this.alertCtrl.create({
        header: 'Transferir a sucursal',
        message: `¿Transferir a ${negocio.negocio_nombre}? ${this.usuario.nombre} quedará inactivo en este negocio.`,
        buttons: [
          { text: 'Cancelar',    role: 'cancel',  handler: () => resolve(false) },
          { text: 'Transferir',  role: 'confirm', handler: () => resolve(true)  }
        ]
      });
      await alert.present();
    });

    if (!confirmado) return;

    this.transfiriendo = true;
    try {
      const ok = await this.usuarioService.transferir(
        this.usuario.membresia_id,
        negocio.negocio_id,
        this.usuario.rol
      );

      if (ok) {
        this.modalCtrl.dismiss({ transferido: true, negocioNombre: negocio.negocio_nombre, empleadoNombre: this.usuario.nombre }, 'confirm');
      } else {
        await this.ui.showError('No se pudo transferir el empleado. Intentá de nuevo.');
      }
    } catch {
      await this.ui.showError('Error al transferir el empleado. Verificá tu conexión.');
    } finally {
      this.transfiriendo = false;
    }
  }

  async confirmar() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    // Superadmin o mismo usuario: solo se permite editar el nombre
    const bloqueado   = this.esSuperadmin || this.esMismoUsuario;
    const rolNuevo    = bloqueado ? this.usuario.rol    : this.form.value.rol;
    const activoNuevo = bloqueado ? this.usuario.activo : this.form.value.activo;

    // ── PROTECCIÓN DEL ÚLTIMO ADMIN ────────────────────────────────
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
      // Superadmin o mismo usuario: solo permitir cambio de nombre, nunca rol/activo
      const dto: UpdateUsuarioDto = bloqueado
        ? { nombre: this.form.value.nombre.trim() }
        : { nombre: this.form.value.nombre.trim(), rol: rolNuevo, activo: activoNuevo };

      const updated = await this.usuarioService.update(this.usuario.id, this.usuario.membresia_id, dto);
      if (updated === 'conflict') {
        await this.ui.showError(`No se puede reactivar a ${this.usuario.nombre}: ya está activo en otra sucursal. Transferilo desde ese negocio para activarlo aquí.`);
        return;
      }
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
