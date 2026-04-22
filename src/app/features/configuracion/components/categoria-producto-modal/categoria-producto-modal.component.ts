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
import { CategoriaProducto } from '../../../inventario/models/categoria-producto.model';

@Component({
  selector: 'app-categoria-producto-modal',
  templateUrl: './categoria-producto-modal.component.html',
  styleUrls: ['./categoria-producto-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonToggle
  ]
})
export class CategoriaProductoModalComponent implements OnInit {
  /** Si se pasa, el modal opera en modo edición. Sin ella, modo creación. */
  @Input() categoria?: CategoriaProducto;

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
      nombre: [this.categoria?.nombre ?? '', [Validators.required, Validators.maxLength(100)]],
      activo: [this.categoria?.activo ?? true]
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

    const raw = this.form.getRawValue();
    this.modalCtrl.dismiss(
      { nombre: (raw.nombre as string).trim(), activo: raw.activo as boolean },
      'confirm'
    );
  }
}
