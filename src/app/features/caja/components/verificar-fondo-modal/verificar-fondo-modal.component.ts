import { AfterViewInit, Component, ElementRef, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonButton, IonIcon, IonSpinner,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, alertCircleOutline, lockOpenOutline, cashOutline
} from 'ionicons/icons';
import { TurnosCajaService } from '../../services/turnos-caja.service';
import { UiService } from '@core/services/ui.service';
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
    IonButton, IonIcon, IonSpinner,
    NumbersOnlyDirective,
    AppCurrencyPipe,
  ]
})
export class VerificarFondoModalComponent implements AfterViewInit {
  private modalCtrl          = inject(ModalController);
  private turnosCajaService  = inject(TurnosCajaService);
  private ui                 = inject(UiService);
  private currencyService    = inject(CurrencyService);

  @ViewChild('montoInput') montoInput?: ElementRef<HTMLInputElement>;

  // Recibida via componentProps desde home.page (0 si no hay déficit de VARIOS)
  deficitVarios = 0;

  // Input libre del empleado
  fondoAperturaStr = '';
  abriendo         = false;
  errorMsg         = '';

  get hayDeficit(): boolean { return this.deficitVarios > 0; }

  get fondoApertura(): number {
    return this.currencyService.parse(this.fondoAperturaStr);
  }

  constructor() {
    addIcons({ closeOutline, alertCircleOutline, lockOpenOutline, cashOutline });
  }

  ngAfterViewInit() {
    // Foco automático al input para que el empleado escriba directamente.
    // Delay para esperar la animación de presentación del bottom-sheet.
    setTimeout(() => this.montoInput?.nativeElement.focus(), 350);
  }

  cancelar() {
    if (this.abriendo) return;
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async abrirCaja(): Promise<void> {
    if (this.abriendo) return;

    if (this.fondoApertura < 0) {
      this.errorMsg = 'El monto no puede ser negativo';
      return;
    }

    this.abriendo = true;
    this.errorMsg = '';

    if (this.hayDeficit) {
      // Hay déficit de VARIOS: reparar + abrir en transacción atómica
      const result = await this.turnosCajaService.repararDeficit(
        this.deficitVarios,
        this.fondoApertura
      );

      if (!result.ok) {
        this.abriendo = false;
        await this.ui.showError(result.errorMsg || 'Error al registrar. Verifica tu conexión e intenta de nuevo.');
        return;
      }

      this.modalCtrl.dismiss({ confirmado: true, turnoId: result.turnoId }, 'confirm');
    } else {
      // Sin déficit: solo confirmar — home.page llama abrirTurno() con el monto
      this.modalCtrl.dismiss({ confirmado: true, fondoApertura: this.fondoApertura }, 'confirm');
    }
  }
}
