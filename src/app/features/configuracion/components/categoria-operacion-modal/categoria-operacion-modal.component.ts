import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonToggle,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import { CategoriaOperacion, CategoriaOperacionInsert } from '../../../dashboard/models/categoria-operacion.model';

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
  private fb        = inject(FormBuilder);

  form!: FormGroup;

  get esNuevo(): boolean { return !this.categoria; }
  get titulo():  string  { return this.esNuevo ? 'Nueva Categoría' : 'Editar Categoría'; }

  constructor() {
    addIcons({ closeOutline });
  }

  ngOnInit() {
    this.form = this.fb.group({
      tipo:        [this.categoria?.tipo        ?? this.tipoInicial, Validators.required],
      nombre:      [this.categoria?.nombre      ?? '',               [Validators.required, Validators.maxLength(80)]],
      descripcion: [this.categoria?.descripcion ?? ''],
      activo:      [this.categoria?.activo      ?? true]
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
      tipo:        raw.tipo         as 'INGRESO' | 'EGRESO',
      nombre:      (raw.nombre      as string).trim(),
      descripcion: (raw.descripcion as string)?.trim() || undefined,
      activo:      raw.activo       as boolean
    };

    this.modalCtrl.dismiss(result, 'confirm');
  }
}
