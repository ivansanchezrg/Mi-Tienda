import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { IonIcon, IonButton, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, addCircleOutline,
  cashOutline, walletOutline, cardOutline, bagOutline,
  storefrontOutline, homeOutline, briefcaseOutline, giftOutline,
  trendingUpOutline, shieldCheckmarkOutline
} from 'ionicons/icons';
import { CajasService } from '../../services/cajas.service';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { NumbersOnlyDirective } from '@shared/directives/numbers-only.directive';

export interface IconOption {
  value: string;
}

export interface ColorOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-nueva-caja-modal',
  templateUrl: './nueva-caja-modal.component.html',
  styleUrls: ['./nueva-caja-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonIcon, IonButton,
    CurrencyInputDirective,
    NumbersOnlyDirective,
  ]
})
export class NuevaCajaModalComponent implements OnInit {
  private modalCtrl    = inject(ModalController);
  private fb           = inject(FormBuilder);
  private cajasService = inject(CajasService);

  form!: FormGroup;
  guardando = false;

  readonly iconOptions: IconOption[] = [
    { value: 'cash-outline' },
    { value: 'wallet-outline' },
    { value: 'card-outline' },
    { value: 'bag-outline' },
    { value: 'storefront-outline' },
    { value: 'home-outline' },
    { value: 'briefcase-outline' },
    { value: 'gift-outline' },
    { value: 'trending-up-outline' },
    { value: 'shield-checkmark-outline' },
  ];

  readonly colorOptions: ColorOption[] = [
    { value: '#3880ff', label: 'Azul' },
    { value: '#2dd36f', label: 'Verde' },
    { value: '#eb445a', label: 'Rojo' },
    { value: '#ffc409', label: 'Amarillo' },
    { value: '#5260ff', label: 'Índigo' },
    { value: '#2dd4bf', label: 'Teal' },
    { value: '#f97316', label: 'Naranja' },
    { value: '#a855f7', label: 'Violeta' },
    { value: '#6c757d', label: 'Gris' },
    { value: '#374151', label: 'Oscuro' },
  ];

  constructor() {
    addIcons({
      closeOutline, addCircleOutline,
      cashOutline, walletOutline, cardOutline, bagOutline,
      storefrontOutline, homeOutline, briefcaseOutline, giftOutline,
      trendingUpOutline, shieldCheckmarkOutline
    });
  }

  ngOnInit() {
    this.form = this.fb.group({
      nombre:       ['', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
      icono:        ['cash-outline', Validators.required],
      color:        ['#3880ff', Validators.required],
      descripcion:  [''],
      saldoInicial: [0],
    });
  }

  seleccionarIcono(valor: string) {
    this.form.patchValue({ icono: valor });
  }

  seleccionarColor(valor: string) {
    this.form.patchValue({ color: valor });
  }

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async confirmar() {
    if (this.form.invalid || this.guardando) {
      this.form.markAllAsTouched();
      return;
    }

    this.guardando = true;
    try {
      const { nombre, icono, color, descripcion, saldoInicial } = this.form.value;
      const caja = await this.cajasService.crearCaja(nombre.trim(), icono, color, descripcion ?? '', saldoInicial ?? 0);
      if (caja) {
        this.modalCtrl.dismiss(caja, 'confirm');
      }
    } finally {
      this.guardando = false;
    }
  }
}
