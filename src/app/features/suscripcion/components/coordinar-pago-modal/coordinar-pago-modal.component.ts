import { Component, inject, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon, IonButton, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, cashOutline, cardOutline, phonePortraitOutline,
  checkmarkCircleOutline, sparklesOutline,
} from 'ionicons/icons';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';

type MetodoPago = 'TRANSFERENCIA' | 'DEPOSITO' | 'EFECTIVO';

interface MetodoOpcion {
  value: MetodoPago;
  label: string;
  icon:  string;
  desc:  string;
}

const METODOS: MetodoOpcion[] = [
  { value: 'TRANSFERENCIA', label: 'Transferencia', icon: 'phone-portrait-outline', desc: 'Transferencia bancaria desde tu app' },
  { value: 'DEPOSITO',      label: 'Depósito',      icon: 'card-outline',           desc: 'Depósito en ventanilla o cajero'   },
  { value: 'EFECTIVO',      label: 'Efectivo',       icon: 'cash-outline',           desc: 'Coordinamos el pago en persona'    },
];

export interface ContextoPago {
  planNombre:    string;
  precio:        number;
  periodo:       'MENSUAL' | 'ANUAL';
  negocioNombre: string;
  /**
   * - 'activar'   → primera compra del plan que se está probando (trial → pago).
   * - 'renovar'   → el cliente ya paga este plan y lo extiende antes de vencer.
   * - 'cambiar'   → upsell/cambio a otro plan o a otro periodo.
   * - 'reactivar' → la suscripción está bloqueada (vencida/suspendida) y se reactiva.
   */
  accion:        'activar' | 'renovar' | 'cambiar' | 'reactivar';
}

@Component({
  selector: 'app-coordinar-pago-modal',
  templateUrl: './coordinar-pago-modal.component.html',
  styleUrls: ['./coordinar-pago-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon, IonButton, AppCurrencyPipe],
})
export class CoorinarPagoModalComponent {
  @Input() contexto!: ContextoPago;

  private modalCtrl = inject(ModalController);

  readonly metodos = METODOS;
  metodoSeleccionado: MetodoPago | null = null;
  referencia = '';

  constructor() {
    addIcons({ closeOutline, cashOutline, cardOutline, phonePortraitOutline, checkmarkCircleOutline, sparklesOutline });
  }

  get periodoLabel(): string {
    return this.contexto.periodo === 'ANUAL' ? 'año' : 'mes';
  }

  get accionLabel(): string {
    switch (this.contexto.accion) {
      case 'activar':    return 'Activación';
      case 'renovar':    return 'Renovación';
      case 'cambiar':    return 'Cambio de plan';
      case 'reactivar':  return 'Reactivación';
    }
  }

  /**
   * Texto del botón de confirmación — cierra el bucle de intención con la que el usuario
   * abrió el modal. El header se mantiene genérico ("Coordinar pago") para no repetir la
   * acción 3 veces; el botón sí la refleja porque es el commit de lo que va a pasar.
   */
  get botonLabel(): string {
    switch (this.contexto.accion) {
      case 'activar':    return 'Activar mi plan';
      case 'renovar':    return 'Renovar mi plan';
      case 'reactivar':  return 'Reactivar';
      case 'cambiar':    return 'Continuar';
    }
  }

  /**
   * La pregunta varía según si el pago ya ocurrió o está por ocurrir.
   * - reactivar + transferencia/depósito: el usuario ya pagó (la pantalla bloqueada lo instruyó a pagar primero)
   * - renovar / cambiar: el usuario inicia el proceso, aún no pagó
   * - efectivo en cualquier contexto: el pago aún no ocurre (visita coordinada)
   */
  get preguntaMetodo(): string {
    if (this.metodoSeleccionado === 'EFECTIVO') {
      return '¿Cómo prefieres pagar?';
    }
    return this.contexto.accion === 'reactivar'
      ? '¿Cómo realizaste el pago?'
      : '¿Cómo vas a realizar el pago?';
  }

  get necesitaReferencia(): boolean {
    return this.metodoSeleccionado === 'TRANSFERENCIA' || this.metodoSeleccionado === 'DEPOSITO';
  }

  get puedeEnviar(): boolean {
    if (!this.metodoSeleccionado) return false;
    if (this.necesitaReferencia) return this.referencia.trim().length > 0;
    return true;
  }

  cerrar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  enviar() {
    if (!this.puedeEnviar) return;
    this.modalCtrl.dismiss(
      { metodo: this.metodoSeleccionado, referencia: this.referencia.trim() },
      'confirm'
    );
  }
}
