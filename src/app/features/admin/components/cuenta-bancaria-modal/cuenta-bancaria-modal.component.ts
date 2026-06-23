import { Component, Input, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { cardOutline, closeOutline } from 'ionicons/icons';
import { CuentaBancaria } from '../../../suscripcion/models/suscripcion.model';

/** Modal para agregar/editar una cuenta bancaria de cobro. Bottom-sheet. */
@Component({
  selector: 'app-cuenta-bancaria-modal',
  templateUrl: './cuenta-bancaria-modal.component.html',
  styleUrls: ['./cuenta-bancaria-modal.component.scss'],
  standalone: true,
  imports: [FormsModule, IonButton, IonIcon],
})
export class CuentaBancariaModalComponent implements OnInit {
  @Input() cuenta: CuentaBancaria | null = null;

  private modalCtrl = inject(ModalController);

  banco = '';
  tipo: 'Ahorros' | 'Corriente' = 'Ahorros';
  numero = '';
  titular = '';
  cedula = '';

  get esEdicion(): boolean {
    return !!this.cuenta;
  }

  constructor() {
    addIcons({ cardOutline, closeOutline });
  }

  ngOnInit() {
    if (this.cuenta) {
      this.banco = this.cuenta.banco;
      this.tipo = this.cuenta.tipo;
      this.numero = this.cuenta.numero;
      this.titular = this.cuenta.titular;
      this.cedula = this.cuenta.cedula;
    }
  }

  get valido(): boolean {
    return this.banco.trim().length > 0
      && this.numero.trim().length > 0
      && this.titular.trim().length > 0
      && this.cedula.trim().length > 0;
  }

  confirmar() {
    if (!this.valido) return;
    const cuenta: CuentaBancaria = {
      banco: this.banco.trim(),
      tipo: this.tipo,
      numero: this.numero.trim(),
      titular: this.titular.trim(),
      cedula: this.cedula.trim(),
    };
    this.modalCtrl.dismiss(cuenta, 'confirm');
  }

  cerrar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
