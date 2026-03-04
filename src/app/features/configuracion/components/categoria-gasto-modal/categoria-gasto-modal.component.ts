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
import { CategoriaGasto, CategoriaGastoInsert } from '../../../gastos-diarios/models/gasto-diario.model';

@Component({
  selector: 'app-categoria-gasto-modal',
  templateUrl: './categoria-gasto-modal.component.html',
  styleUrls: ['./categoria-gasto-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonToggle
  ]
})
export class CategoriaGastoModalComponent implements OnInit {
  /** Si se pasa, el modal opera en modo edición. Sin ella, modo creación. */
  @Input() categoria?: CategoriaGasto;

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
      nombre:      [this.categoria?.nombre      ?? '', [Validators.required, Validators.maxLength(80)]],
      descripcion: [this.categoria?.descripcion ?? ''],
      activo:      [this.categoria?.activo      ?? true]
    });
  }

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  confirmar() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const result: CategoriaGastoInsert = {
      nombre:      (this.form.value.nombre      as string).trim(),
      descripcion: (this.form.value.descripcion as string)?.trim() || undefined,
      activo:      this.form.value.activo as boolean
    };

    this.modalCtrl.dismiss(result, 'confirm');
  }
}
