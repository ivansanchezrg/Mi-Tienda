import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonCard, IonIcon, IonCheckbox,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  close, alertCircleOutline, checkmarkCircle, checkmarkCircleOutline,
  walletOutline, cashOutline, briefcaseOutline,
  timeOutline, lockOpenOutline
} from 'ionicons/icons';
import { TurnosCajaService } from '../../services/turnos-caja.service';

@Component({
  selector: 'app-verificar-fondo-modal',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Abrir Caja</ion-title>
        <ion-buttons slot="end">
          @if (!hayDeficit || pasoActual === 2) {
            <ion-button (click)="cancelar()">
              <ion-icon slot="icon-only" name="close"></ion-icon>
            </ion-button>
          }
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">

      <!-- INDICADOR DE PASOS (solo si hay déficit) -->
      @if (hayDeficit) {
        <div class="paso-indicator">
          <div class="paso-dot" [class.activo]="pasoActual === 1" [class.completado]="pasoActual === 2">
            @if (pasoActual === 2) {
              <ion-icon name="checkmark-circle"></ion-icon>
            } @else {
              1
            }
          </div>
          <div class="paso-linea" [class.completada]="pasoActual === 2"></div>
          <div class="paso-dot" [class.activo]="pasoActual === 2">2</div>
        </div>
        <div class="paso-labels">
          <span [class.activo]="pasoActual === 1" [class.completado]="pasoActual === 2">Reponer déficit</span>
          <span [class.activo]="pasoActual === 2">Verificar fondo</span>
        </div>
      }

      <ion-card class="verificar-card">
        <div class="verificacion-content">

          <!-- ====== PASO 1: REPONER DÉFICIT ====== -->
          @if (hayDeficit && pasoActual === 1) {

            <div class="deficit-header">
              <ion-icon name="alert-circle-outline" class="deficit-icon-grande"></ion-icon>
              <h2 class="deficit-titulo">Déficit del turno anterior</h2>
              <p class="deficit-subtitulo">El turno anterior cerró sin completar las transferencias</p>
            </div>

            <div class="deficit-resumen">
              @if (deficitCajaChica > 0) {
                <div class="deficit-item">
                  <div class="deficit-item-left">
                    <ion-icon name="wallet-outline" color="warning"></ion-icon>
                    <span>Varios pendiente</span>
                  </div>
                  <span class="deficit-monto warning">\${{ deficitCajaChica | number:'1.2-2' }}</span>
                </div>
              }
              @if (fondoFaltante > 0) {
                <div class="deficit-item">
                  <div class="deficit-item-left">
                    <ion-icon name="cash-outline" color="success"></ion-icon>
                    <span>Fondo faltante</span>
                  </div>
                  <span class="deficit-monto success">\${{ fondoFaltante | number:'1.2-2' }}</span>
                </div>
              }
              <div class="deficit-item total">
                <div class="deficit-item-left">
                  <ion-icon name="briefcase-outline" color="primary"></ion-icon>
                  <span>Retirar de TIENDA</span>
                </div>
                <span class="deficit-monto primary">\${{ totalAReponer | number:'1.2-2' }}</span>
              </div>
            </div>

            <div class="instrucciones-fisicas">
              <p class="instrucciones-titulo">Haz esto ahora físicamente:</p>
              <div class="instrucciones-pasos">
                <div class="instruccion-paso">
                  <div class="paso-numero">1</div>
                  <p>Toma <strong>\${{ totalAReponer | number:'1.2-2' }}</strong> de la funda <strong>TIENDA</strong></p>
                </div>
                @if (deficitCajaChica > 0) {
                  <div class="instruccion-paso">
                    <div class="paso-numero">2</div>
                    <p>Pon <strong>\${{ deficitCajaChica | number:'1.2-2' }}</strong> en la funda <strong>VARIOS</strong></p>
                  </div>
                }
                @if (fondoFaltante > 0) {
                  <div class="instruccion-paso">
                    <div class="paso-numero">{{ deficitCajaChica > 0 ? 3 : 2 }}</div>
                    <p>Deja <strong>\${{ fondoFaltante | number:'1.2-2' }}</strong> en la <strong>caja física</strong></p>
                  </div>
                }
              </div>
            </div>

            @if (errorMsg) {
              <div class="error-banner">
                <ion-icon name="alert-circle-outline"></ion-icon>
                <span>{{ errorMsg }}</span>
              </div>
            }

            <div class="actions-section">
              <ion-button
                expand="block"
                fill="clear"
                color="medium"
                [disabled]="registrando"
                (click)="cancelar()">
                Cancelar
              </ion-button>
              <ion-button
                expand="block"
                color="warning"
                [disabled]="registrando"
                (click)="registrarYAvanzar()"
                style="--border-radius: 8px">
                @if (registrando) {
                  <ion-icon name="time-outline" slot="start"></ion-icon>
                  Registrando...
                } @else {
                  <ion-icon name="checkmark-circle-outline" slot="start"></ion-icon>
                  Ya lo hice — Registrar en sistema
                }
              </ion-button>
            </div>
          }

          <!-- ====== PASO 2: VERIFICAR FONDO ====== -->
          @if (!hayDeficit || pasoActual === 2) {

            @if (hayDeficit && pasoActual === 2) {
              <div class="paso1-ok">
                <ion-icon name="checkmark-circle" color="success"></ion-icon>
                <div class="paso1-ok-text">
                  <strong>Operaciones registradas</strong>
                  <span>EGRESO Tienda −\${{ totalAReponer | number:'1.2-2' }}
                    @if (deficitCajaChica > 0) { · INGRESO Varios +\${{ deficitCajaChica | number:'1.2-2' }} }
                  </span>
                </div>
              </div>
            }

            <div class="info-section">
              <div class="info-row">
                <ion-icon name="cash-outline" color="success"></ion-icon>
                <div class="info-text">
                  <div class="info-label">Fondo fijo inicial</div>
                  <div class="info-value">\${{ fondoFijo | number:'1.2-2' }}</div>
                </div>
              </div>
              <p class="info-descripcion">
                Confirma que este monto está en la caja física antes de continuar.
              </p>
            </div>

            <div class="checkbox-section">
              <ion-checkbox [(ngModel)]="confirmado" labelPlacement="end">
                He verificado el fondo en la caja
              </ion-checkbox>
            </div>

            <div class="actions-section">
              <ion-button
                expand="block"
                color="success"
                [disabled]="!confirmado"
                (click)="abrirCaja()"
                style="--border-radius: 8px">
                <ion-icon name="lock-open-outline" slot="start"></ion-icon>
                Abrir Caja
              </ion-button>
              <ion-button
                expand="block"
                fill="clear"
                color="medium"
                (click)="cancelar()">
                Cancelar
              </ion-button>
            </div>
          }

        </div>
      </ion-card>
    </ion-content>
  `,
  styles: [`
    ion-content {
      --padding-top: 8px;
      --padding-bottom: 8px;
    }

    .paso-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px 24px 4px;
      gap: 0;

      .paso-dot {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: var(--ion-color-light);
        border: 2px solid var(--ion-color-medium-shade);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        font-weight: 700;
        color: var(--ion-color-medium-shade);
        flex-shrink: 0;
        transition: all 0.3s ease;

        ion-icon { font-size: 18px; }

        &.activo {
          background: var(--ion-color-warning);
          border-color: var(--ion-color-warning);
          color: white;
        }

        &.completado {
          background: var(--ion-color-success);
          border-color: var(--ion-color-success);
          color: white;
        }
      }

      .paso-linea {
        flex: 1;
        height: 2px;
        background: var(--ion-color-light-shade);
        max-width: 80px;
        transition: background 0.3s ease;

        &.completada { background: var(--ion-color-success); }
      }
    }

    .paso-labels {
      display: flex;
      justify-content: space-around;
      padding: 4px 8px 12px;

      span {
        font-size: 11px;
        color: var(--ion-color-medium);
        transition: color 0.3s ease;

        &.activo { color: var(--ion-color-warning-shade); font-weight: 600; }
        &.completado { color: var(--ion-color-success); font-weight: 600; }
      }
    }

    .verificar-card {
      margin: 0;
      border-radius: 16px;
      box-shadow: none;
    }

    .verificacion-content {
      display: flex;
      flex-direction: column;
      gap: 20px;
      padding: 20px;

      .deficit-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 6px;

        .deficit-icon-grande { font-size: 44px; color: var(--ion-color-warning); }
        .deficit-titulo { font-size: 17px; font-weight: 700; color: var(--ion-color-warning-shade); margin: 0; }
        .deficit-subtitulo { font-size: 13px; color: var(--ion-color-medium); margin: 0; }
      }

      .deficit-resumen {
        background: var(--ion-color-light);
        border-radius: 12px;
        padding: 4px 0;
        overflow: hidden;

        .deficit-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          border-bottom: 1px solid var(--ion-color-light-shade);

          &:last-child { border-bottom: none; }
          &.total { background: rgba(var(--ion-color-primary-rgb), 0.06); font-weight: 700; }

          .deficit-item-left {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            color: var(--ion-color-dark);
            ion-icon { font-size: 17px; }
          }

          .deficit-monto {
            font-size: 15px;
            font-weight: 700;
            &.warning { color: var(--ion-color-warning-shade); }
            &.success { color: var(--ion-color-success); }
            &.primary { color: var(--ion-color-primary); }
          }
        }
      }

      .instrucciones-fisicas {
        .instrucciones-titulo { font-size: 13px; font-weight: 600; color: var(--ion-color-dark); margin: 0 0 10px 0; }

        .instrucciones-pasos {
          display: flex;
          flex-direction: column;
          gap: 8px;

          .instruccion-paso {
            display: flex;
            align-items: flex-start;
            gap: 10px;

            .paso-numero {
              width: 22px;
              height: 22px;
              border-radius: 50%;
              background: var(--ion-color-primary);
              color: white;
              font-size: 12px;
              font-weight: 700;
              display: flex;
              align-items: center;
              justify-content: center;
              flex-shrink: 0;
              margin-top: 1px;
            }

            p { font-size: 13px; color: var(--ion-color-dark); margin: 0; line-height: 1.4; }
          }
        }
      }

      .error-banner {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        background: rgba(var(--ion-color-danger-rgb), 0.08);
        border: 1px solid var(--ion-color-danger);
        border-radius: 8px;
        font-size: 13px;
        color: var(--ion-color-danger);
        ion-icon { font-size: 18px; flex-shrink: 0; }
      }

      .paso1-ok {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px;
        background: rgba(var(--ion-color-success-rgb), 0.08);
        border: 1px solid var(--ion-color-success);
        border-radius: 10px;
        ion-icon { font-size: 24px; flex-shrink: 0; }

        .paso1-ok-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
          strong { font-size: 13px; color: var(--ion-color-success-shade); }
          span { font-size: 12px; color: var(--ion-color-medium); }
        }
      }

      .info-section {
        .info-row {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          gap: 12px;
          padding: 20px;
          background: var(--ion-color-light);
          border-radius: 12px;
          margin-bottom: 12px;
          ion-icon { font-size: 32px; flex-shrink: 0; }

          .info-text {
            .info-label { font-size: 13px; color: var(--ion-color-medium); margin-bottom: 4px; }
            .info-value { font-size: 28px; font-weight: 700; color: var(--ion-color-success); }
          }
        }

        .info-descripcion {
          font-size: 13px;
          color: var(--ion-color-medium);
          line-height: 1.4;
          margin: 0;
          text-align: center;
        }
      }

      .checkbox-section {
        ion-checkbox { --size: 20px; width: 100%; }
      }

      .actions-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
        ion-button { margin: 0; }
      }
    }
  `],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonCard, IonIcon, IonCheckbox
  ]
})
export class VerificarFondoModalComponent {
  private modalCtrl        = inject(ModalController);
  private turnosCajaService = inject(TurnosCajaService);

  // Props recibidas
  fondoFijo        = 40.00;
  deficitCajaChica = 0;
  fondoFaltante    = 0;

  // Estado interno
  pasoActual: 1 | 2 = 1;
  confirmado  = false;
  registrando = false;
  errorMsg    = '';

  constructor() {
    addIcons({
      close, alertCircleOutline, checkmarkCircle, checkmarkCircleOutline,
      walletOutline, cashOutline, briefcaseOutline,
      timeOutline, lockOpenOutline
    });
  }

  get hayDeficit(): boolean {
    return this.deficitCajaChica > 0 || this.fondoFaltante > 0;
  }

  get totalAReponer(): number {
    return this.deficitCajaChica + this.fondoFaltante;
  }

  async registrarYAvanzar(): Promise<void> {
    this.registrando = true;
    this.errorMsg    = '';

    const result = await this.turnosCajaService.repararDeficit(
      this.deficitCajaChica,
      this.fondoFaltante
    );

    this.registrando = false;

    if (!result.ok) {
      this.errorMsg = result.errorMsg || 'Error al registrar. Verifica tu conexión e intenta de nuevo.';
      return;
    }

    this.pasoActual = 2;
  }

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  abrirCaja() {
    this.modalCtrl.dismiss({ confirmado: true }, 'confirm');
  }
}
