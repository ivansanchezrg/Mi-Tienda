import { AfterViewInit, Component, ElementRef, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonButton, IonIcon, IonSpinner, IonCheckbox,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, alertCircleOutline, lockOpenOutline, cashOutline, checkmarkCircleOutline
} from 'ionicons/icons';
import { TurnosCajaService, TurnoMutacionResult } from '../../services/turnos-caja.service';
import { FeedbackOverlayService } from '@core/services/feedback-overlay.service';
import { CurrencyService } from '@core/services/currency.service';
import { NumbersOnlyDirective } from '@shared/directives/numbers-only.directive';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';

@Component({
  selector: 'app-verificar-fondo-modal',
  templateUrl: './verificar-fondo-modal.component.html',
  styleUrls: ['./verificar-fondo-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonButton, IonIcon, IonSpinner, IonCheckbox,
    NumbersOnlyDirective,
    AppCurrencyPipe,
  ]
})
export class VerificarFondoModalComponent implements AfterViewInit {
  private modalCtrl          = inject(ModalController);
  private turnosCajaService  = inject(TurnosCajaService);
  private feedback           = inject(FeedbackOverlayService);
  private currencyService    = inject(CurrencyService);

  @ViewChild('montoInput') montoInput?: ElementRef<HTMLInputElement>;

  // Recibida via componentProps desde home.page (0 si no hay déficit de VARIOS)
  deficitVarios = 0;

  /**
   * Callback que ejecuta la apertura del turno SIN déficit (fn_abrir_turno).
   * Lo provee el home vía componentProps. Se ejecuta DENTRO del modal (patrón
   * onConfirmar) para que el spinner "Abriendo..." refleje la mutación real y, si
   * falla (red caída, timeout), el modal quede abierto para reintentar en vez de
   * cerrarse dejando la operación en el aire. Retorna TurnoMutacionResult, cuyo
   * `feedback` decide qué mostrar (ver mostrarErrorApertura).
   * El camino CON déficit no lo usa: ese ejecuta repararDeficit() internamente.
   */
  onAbrir?: (fondoApertura: number) => Promise<TurnoMutacionResult>;

  // Input libre del empleado
  fondoAperturaStr = '';
  abriendo         = false;
  errorMsg         = '';

  // Confirmación explícita del traspaso físico de efectivo (Tienda → Varios).
  // El sistema registra el asiento contable automáticamente al abrir, pero no
  // puede verificar que el empleado movió el dinero físico — por eso este
  // checkbox es un gate de responsabilidad humana, no una condición técnica.
  confirmoTraspaso = false;

  get hayDeficit(): boolean { return this.deficitVarios > 0; }

  get puedeAbrir(): boolean {
    return !this.hayDeficit || this.confirmoTraspaso;
  }

  get fondoApertura(): number {
    return this.currencyService.parse(this.fondoAperturaStr);
  }

  constructor() {
    addIcons({ closeOutline, alertCircleOutline, lockOpenOutline, cashOutline, checkmarkCircleOutline });
  }

  ngAfterViewInit() {
    // Foco automático al input para que el empleado escriba directamente.
    // Si hay déficit sin confirmar, el input todavía no existe en el DOM —
    // el foco se otorga recién al marcar el checkbox (onConfirmoTraspasoChange).
    // Delay para esperar la animación de presentación del bottom-sheet.
    if (!this.hayDeficit) {
      setTimeout(() => this.montoInput?.nativeElement.focus(), 350);
    }
  }

  onConfirmoTraspasoChange(checked: boolean): void {
    this.confirmoTraspaso = checked;
    if (checked) {
      setTimeout(() => this.montoInput?.nativeElement.focus(), 100);
    }
  }

  cancelar() {
    if (this.abriendo) return;
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async abrirCaja(): Promise<void> {
    if (this.abriendo || !this.puedeAbrir) return;

    if (this.fondoApertura < 0) {
      this.errorMsg = 'El monto no puede ser negativo';
      return;
    }

    this.abriendo = true;
    this.errorMsg = '';

    // try/catch envolvente: si la mutación rechaza de forma inesperada (los servicios
    // normalmente NO lanzan — devuelven {ok:false} — pero un fallo previo como
    // getUsuarioActual() sí puede rechazar), el botón no puede quedar atascado en
    // "Abriendo..." sin salida. abriendo solo permanece true tras un dismiss exitoso
    // (anti doble-tap durante la animación de cierre).
    try {
      if (this.hayDeficit) {
        // Hay déficit de VARIOS: reparar + abrir en transacción atómica
        const result = await this.turnosCajaService.repararDeficit(
          this.deficitVarios,
          this.fondoApertura
        );

        if (!result.ok) {
          this.abriendo = false;
          this.mostrarErrorApertura(result);
          return;
        }

        this.modalCtrl.dismiss({ confirmado: true, turnoId: result.turnoId, fondoApertura: this.fondoApertura }, 'confirm');
      } else {
        // Sin déficit: ejecutar la apertura DENTRO del modal (patrón onConfirmar) para
        // que el spinner "Abriendo..." refleje la mutación real. Solo cierra si tiene
        // éxito; si falla (red/timeout), el modal queda abierto para reintentar.
        // Sin callback no hay mutación posible → fail-closed (nunca fingir éxito en
        // una operación financiera).
        if (!this.onAbrir) {
          this.abriendo = false;
          this.errorMsg = 'No se pudo iniciar la apertura. Cierra este diálogo e intenta de nuevo.';
          return;
        }

        const result = await this.onAbrir(this.fondoApertura);

        if (!result.ok) {
          this.abriendo = false;
          this.mostrarErrorApertura(result);
          return;
        }

        this.modalCtrl.dismiss({ confirmado: true, fondoApertura: this.fondoApertura }, 'confirm');
      }
    } catch (error: any) {
      // Rechazo inesperado (los servicios normalmente no lanzan). Tratarlo como error
      // de negocio con su mensaje — es un caso raro, no la ruta de red esperada.
      this.abriendo = false;
      this.mostrarErrorApertura({ ok: false, feedback: 'mensaje', errorMsg: error?.message });
    }
  }

  /**
   * Aplica el feedback de un fallo al abrir turno según `result.feedback`:
   *  - 'silenciar' → no mostrar nada: el banner global amarillo "Sin conexión a
   *    internet" ya comunica el estado (el navegador sabe que no hay red).
   *  - 'red'       → overlay de conexión: el WiFi está "conectado pero roto" (timeout),
   *    el banner NO aparece y sin esto el usuario no sabría por qué falló.
   *  - 'mensaje'   → mensaje inline en el modal (regla de negocio, ej. "Ya hay un turno
   *    abierto por X"): el usuario lee la causa concreta y el modal sigue abierto.
   */
  private mostrarErrorApertura(result: TurnoMutacionResult): void {
    switch (result.feedback) {
      case 'silenciar':
        return;
      case 'red':
        this.feedback.error({
          titulo: 'No se pudo abrir el turno',
          subtitulo: 'El servidor no respondió. Verifica tu conexión e intenta de nuevo.',
        });
        return;
      default:
        this.errorMsg = result.errorMsg || 'No se pudo abrir el turno. Intenta de nuevo.';
    }
  }
}
