import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonToggle,
  ModalController, AlertController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, trashOutline } from 'ionicons/icons';
import { CategoriaOperacion, CategoriaOperacionInsert } from '../../../caja/models/categoria-operacion.model';

@Component({
  selector: 'app-categoria-operacion-modal',
  templateUrl: './categoria-operacion-modal.component.html',
  styleUrls: ['./categoria-operacion-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonToggle
  ]
})
export class CategoriaOperacionModalComponent implements OnInit {
  /** Si se pasa, el modal opera en modo edición. Sin ella, modo creación. */
  @Input() categoria?: CategoriaOperacion;
  /** Tipo pre-seleccionado al crear. Lo pasa la página según el segmento activo. */
  @Input() tipoInicial: 'EGRESO' | 'INGRESO' = 'EGRESO';

  private modalCtrl = inject(ModalController);
  private alertCtrl = inject(AlertController);
  private fb        = inject(FormBuilder);

  form!: FormGroup;

  get esNuevo(): boolean { return !this.categoria; }
  get titulo():  string  { return this.esNuevo ? 'Nueva Categoría' : 'Editar Categoría'; }

  constructor() {
    addIcons({ closeOutline, trashOutline });
  }

  ngOnInit() {
    this.form = this.fb.group({
      tipo:                [this.categoria?.tipo                 ?? this.tipoInicial, Validators.required],
      nombre:              [this.categoria?.nombre              ?? '',               [Validators.required, Validators.maxLength(80)]],
      descripcion:         [this.categoria?.descripcion         ?? ''],
      requiereDescripcion: [this.categoria?.requiere_descripcion ?? false],
      activo:              [this.categoria?.activo              ?? true]
    });

    // El tipo siempre está fijo: viene del segmento activo (crear) o de la
    // categoría existente (editar). No tiene sentido que el usuario lo cambie.
    this.form.get('tipo')?.disable();
  }

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  confirmar() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    // getRawValue() incluye los controles deshabilitados (tipo)
    const raw = this.form.getRawValue();
    const result: CategoriaOperacionInsert = {
      tipo:                 raw.tipo                as 'INGRESO' | 'EGRESO',
      nombre:               (raw.nombre             as string).trim(),
      descripcion:          (raw.descripcion        as string)?.trim() || undefined,
      requiere_descripcion: raw.requiereDescripcion as boolean,
      activo:               raw.activo              as boolean
    };

    this.modalCtrl.dismiss(result, 'confirm');
  }

  /**
   * Pide confirmación y, si se acepta, cierra el modal con role 'delete'.
   * El borrado real (y la validación de historial) lo hace la página llamadora
   * vía CategoriasOperacionesService.eliminar() — este modal solo confirma intención.
   */
  async eliminar() {
    const alert = await this.alertCtrl.create({
      header: 'Eliminar categoría',
      message: `¿Seguro que quieres eliminar "${this.categoria?.nombre}"? Esta acción no se puede deshacer.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive', handler: () => this.modalCtrl.dismiss(null, 'delete') }
      ]
    });
    await alert.present();
  }
}
