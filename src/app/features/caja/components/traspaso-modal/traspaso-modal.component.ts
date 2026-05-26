import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { IonIcon, IonButton, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, swapHorizontalOutline, cashOutline, fileTrayOutline, archiveOutline, arrowDownOutline, checkmarkCircle } from 'ionicons/icons';
import { Caja } from '../../services/cajas.service';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { NumbersOnlyDirective } from '@shared/directives/numbers-only.directive';

export interface TraspasoModalResult {
  codigoOrigen:  string;
  codigoDestino: string;
  monto:         number;
  descripcion:   string;
}

const CAJA_ICONOS: Record<string, string> = {
  CAJA:       'cash-outline',
  CAJA_CHICA: 'file-tray-outline',
  VARIOS:     'archive-outline',
};

@Component({
  selector: 'app-traspaso-modal',
  templateUrl: './traspaso-modal.component.html',
  styleUrls: ['./traspaso-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonIcon, IonButton,
    CurrencyInputDirective,
    NumbersOnlyDirective,
  ]
})
export class TraspasoModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private fb        = inject(FormBuilder);

  @Input() cajas: Caja[] = [];
  @Input() cajaAbierta = false;

  form!: FormGroup;

  // Solo CAJA, CAJA_CHICA (si turno abierto) y VARIOS — sin Celular ni Bus
  get cajasDisponibles(): Caja[] {
    return this.cajas.filter(c => {
      if (c.codigo === 'CAJA_CHICA') return this.cajaAbierta;
      return c.codigo === 'CAJA' || c.codigo === 'VARIOS';
    });
  }

  constructor() {
    addIcons({ closeOutline, swapHorizontalOutline, cashOutline, fileTrayOutline, archiveOutline, arrowDownOutline, checkmarkCircle });
  }

  ngOnInit() {
    this.form = this.fb.group({
      origenId:    [null, Validators.required],
      destinoId:   [null, Validators.required],
      monto:       [null, [Validators.required, Validators.min(0.01)]],
      descripcion: [''],
    });
  }

  // Cajas disponibles como destino — excluye la seleccionada como origen
  get cajasDestino(): Caja[] {
    const origenId = this.form?.get('origenId')?.value;
    if (!origenId) return [];
    return this.cajasDisponibles.filter(c => c.id !== origenId);
  }

  get saldoOrigen(): number {
    const id = this.form?.get('origenId')?.value;
    return this.cajas.find(c => c.id === id)?.saldo_actual ?? 0;
  }

  get montoExcedeSaldo(): boolean {
    return (this.form?.get('monto')?.value ?? 0) > this.saldoOrigen;
  }

  iconoCaja(codigo: string, icono?: string): string {
    return icono || CAJA_ICONOS[codigo] || 'cash-outline';
  }

  seleccionarOrigen(caja: Caja) {
    // Si el destino actual es igual al nuevo origen, lo limpia
    if (this.form.get('destinoId')?.value === caja.id) {
      this.form.patchValue({ destinoId: null });
    }
    this.form.patchValue({ origenId: caja.id });
    this.form.get('origenId')?.markAsTouched();
  }

  seleccionarDestino(caja: Caja) {
    this.form.patchValue({ destinoId: caja.id });
    this.form.get('destinoId')?.markAsTouched();
  }

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  confirmar() {
    if (this.form.invalid || this.montoExcedeSaldo) {
      this.form.markAllAsTouched();
      return;
    }

    const origen  = this.cajas.find(c => c.id === this.form.value.origenId)!;
    const destino = this.cajas.find(c => c.id === this.form.value.destinoId)!;

    const result: TraspasoModalResult = {
      codigoOrigen:  origen.codigo,
      codigoDestino: destino.codigo,
      monto:         this.form.value.monto,
      descripcion:   this.form.value.descripcion ?? '',
    };

    this.modalCtrl.dismiss(result, 'confirm');
  }
}
