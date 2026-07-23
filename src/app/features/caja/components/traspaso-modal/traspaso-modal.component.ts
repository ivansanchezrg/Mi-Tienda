import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { IonIcon, IonButton, IonSpinner, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, swapHorizontalOutline, cashOutline, fileTrayOutline, archiveOutline, arrowDownOutline, arrowUpOutline, checkmarkCircle } from 'ionicons/icons';
import { Caja } from '../../services/cajas.service';
import { OperacionesCajaService } from '../../services/operaciones-caja.service';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { CurrencyService } from '@core/services/currency.service';
import { NumbersOnlyDirective } from '@shared/directives/numbers-only.directive';
import { HorizontalScrollDirective } from '@shared/directives/horizontal-scroll.directive';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';

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
    IonIcon, IonButton, IonSpinner,
    CurrencyInputDirective,
    NumbersOnlyDirective,
    HorizontalScrollDirective,
    AppCurrencyPipe,
  ]
})
export class TraspasoModalComponent implements OnInit {
  private modalCtrl          = inject(ModalController);
  private fb                 = inject(FormBuilder);
  private operacionesService = inject(OperacionesCajaService);
  private currency           = inject(CurrencyService);

  @Input() cajas: Caja[] = [];
  @Input() cajaAbierta = false;
  @Input() variosActiva = false;

  form!: FormGroup;
  guardando = false;

  // Solo CAJA, CAJA_CHICA (si turno abierto) y VARIOS (si activa) — sin Celular ni Bus
  get cajasDisponibles(): Caja[] {
    return this.cajas.filter(c => {
      if (c.codigo === 'CAJA_CHICA') return this.cajaAbierta;
      if (c.codigo === 'VARIOS')     return this.variosActiva;
      return c.codigo === 'CAJA';
    });
  }

  constructor() {
    addIcons({ closeOutline, swapHorizontalOutline, cashOutline, fileTrayOutline, archiveOutline, arrowDownOutline, arrowUpOutline, checkmarkCircle });
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

  /** True cuando ya se eligió la caja origen — habilita el paso "Hacia" (flujo progresivo). */
  get origenSeleccionado(): boolean {
    return !!this.form?.get('origenId')?.value;
  }

  /** True cuando ya se eligió el destino — habilita Monto + Descripción (flujo progresivo). */
  get destinoSeleccionado(): boolean {
    return !!this.form?.get('destinoId')?.value;
  }

  /** Monto como NÚMERO real. El input puede traer coma decimal cruda ("20,00") mientras se
   *  escribe — parse() la interpreta bien. Sin esto, "saldo + '20,00'" hacía coerción de string. */
  get montoNumerico(): number {
    return this.currency.parse(this.form?.get('monto')?.value);
  }

  get saldoOrigen(): number {
    const id = this.form?.get('origenId')?.value;
    return this.cajas.find(c => c.id === id)?.saldo_actual ?? 0;
  }

  get montoExcedeSaldo(): boolean {
    return this.montoNumerico > this.saldoOrigen;
  }

  get saldoDestino(): number {
    const id = this.form?.get('destinoId')?.value;
    return this.cajas.find(c => c.id === id)?.saldo_actual ?? 0;
  }

  get nombreOrigen(): string {
    const id = this.form?.get('origenId')?.value;
    return this.cajas.find(c => c.id === id)?.nombre ?? '';
  }

  get nombreDestino(): string {
    const id = this.form?.get('destinoId')?.value;
    return this.cajas.find(c => c.id === id)?.nombre ?? '';
  }

  /** Preview de saldos resultantes — visible cuando el traspaso está completo y es válido */
  get mostrarPreview(): boolean {
    return this.origenSeleccionado
        && this.destinoSeleccionado
        && this.montoNumerico > 0
        && !this.montoExcedeSaldo;
  }

  get saldoOrigenDespues(): number {
    return this.saldoOrigen - this.montoNumerico;
  }

  get saldoDestinoDespues(): number {
    return this.saldoDestino + this.montoNumerico;
  }

  iconoCaja(codigo: string, icono?: string): string {
    return icono || CAJA_ICONOS[codigo] || 'cash-outline';
  }

  seleccionarOrigen(caja: Caja) {
    if (this.form.get('destinoId')?.value === caja.id) {
      this.form.patchValue({ destinoId: null });
    }
    this.form.patchValue({ origenId: caja.id });
    this.form.get('origenId')?.markAsTouched();
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`.caja-scroll [data-origen-id="${caja.id}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 0);
  }

  seleccionarDestino(caja: Caja) {
    this.form.patchValue({ destinoId: caja.id });
    this.form.get('destinoId')?.markAsTouched();
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`.caja-scroll [data-destino-id="${caja.id}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 0);
  }

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async confirmar() {
    if (this.form.invalid || this.montoExcedeSaldo) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.guardando) return;
    this.guardando = true;

    const origen  = this.cajas.find(c => c.id === this.form.value.origenId)!;
    const destino = this.cajas.find(c => c.id === this.form.value.destinoId)!;

    const result = await this.operacionesService.registrarTransferencia(
      origen.codigo,
      destino.codigo,
      // parse(): a la BD va el número real, no el string crudo con posible coma decimal.
      this.currency.parse(this.form.value.monto),
      this.form.value.descripcion ?? '',
    );

    if (result.ok) {
      this.modalCtrl.dismiss(null, 'confirm');
      return;
    }

    // Si fue saldo insuficiente, el Realtime ya actualizó this.cajas via el padre.
    // Solo mostramos el error — el card se corrige solo en el siguiente ciclo.
    this.guardando = false;
  }
}
