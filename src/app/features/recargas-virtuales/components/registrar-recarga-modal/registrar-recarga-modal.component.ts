import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonIcon, IonSpinner, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, checkmarkOutline,
  phonePortraitOutline, busOutline,
  checkmarkCircleOutline, alertCircleOutline, trendingUpOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { FeedbackOverlayService } from '@core/services/feedback-overlay.service';
import { SupabaseService } from '@core/services/supabase.service';
import { RecargasVirtualesService } from '../../services/recargas-virtuales.service';
import { AuthService } from '../../../auth/services/auth.service';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { NumbersOnlyDirective } from '@shared/directives/numbers-only.directive';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';
import { CurrencyService } from '@core/services/currency.service';
import { getFechaLocal } from '@core/utils/date.util';

type TipoServicio = 'CELULAR' | 'BUS';

@Component({
  selector: 'app-registrar-recarga-modal',
  templateUrl: './registrar-recarga-modal.component.html',
  styleUrls: ['./registrar-recarga-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonIcon, IonSpinner,
    CurrencyInputDirective,
    NumbersOnlyDirective,
    AppCurrencyPipe,
  ]
})
export class RegistrarRecargaModalComponent implements OnInit {
  @Input() tipo: TipoServicio = 'CELULAR';

  private modalCtrl = inject(ModalController);
  private ui = inject(UiService);
  private feedback = inject(FeedbackOverlayService);
  private supabase = inject(SupabaseService);
  private service = inject(RecargasVirtualesService);
  private authService = inject(AuthService);
  private currencyService = inject(CurrencyService);

  comisionPct: number = 5;

  // El input de monto es type="text" y bindea al TEXTO visible (montoVirtualTexto),
  // no al número. Así el valor se puede mostrar siempre formateado ("694.70"),
  // incluso cuando lo auto-rellena el código (donde el blur de appCurrencyInput
  // nunca dispara porque el usuario no tocó el campo → antes quedaba "694.7").
  // montoVirtual es el getter NUMÉRICO derivado del texto — lo usan toda la
  // aritmética (montoAPagar, ganancia...) y el RPC, sin cambios.
  montoVirtualTexto: string = '';
  get montoVirtual(): number | null {
    return this.montoVirtualTexto === '' ? null : this.currencyService.parse(this.montoVirtualTexto);
  }

  guardando = false;

  // BUS
  saldoCajaBus: number = 0;
  saldoVirtualSistemaBus: number = 0; // último cierre + recargas post-cierre

  // El campo "Saldo en la máquina" lo teclea el usuario. Bindea al texto visible
  // (mismo motivo que montoVirtualTexto) y al cambiar recalcula el monto a depositar.
  saldoVirtualMaquinaTexto: string = '';
  get saldoVirtualMaquina(): number | null {
    return this.saldoVirtualMaquinaTexto === '' ? null : this.currencyService.parse(this.saldoVirtualMaquinaTexto);
  }

  onSaldoMaquinaChange(): void {
    const parsed = this.saldoVirtualMaquina;
    if (parsed !== null && parsed >= 0) {
      const disponible = this.saldoCajaBus + Math.max(0, this.saldoVirtualSistemaBus - parsed);
      // Escribir el TEXTO ya formateado ("694.70") — no el número crudo — para que
      // el campo se vea completo desde el auto-relleno, sin depender del blur.
      this.montoVirtualTexto = disponible > 0 ? this.currencyService.format(disponible) : '';
    }
  }

  constructor() {
    addIcons({
      closeOutline,
      checkmarkOutline,
      phonePortraitOutline,
      busOutline,
      checkmarkCircleOutline,
      alertCircleOutline,
      trendingUpOutline
    });
  }

  async ngOnInit() {
    try {
      if (this.tipo === 'CELULAR') {
        this.comisionPct = await this.service.getPorcentajeComision('CELULAR');
      } else {
        const [saldoCaja, saldoVirtual] = await Promise.all([
          this.service.getSaldoCajaActual('CAJA_BUS'),
          this.service.getSaldoVirtualActual('BUS')
        ]);
        this.saldoCajaBus = saldoCaja;
        this.saldoVirtualSistemaBus = saldoVirtual;
      }
    } catch (error) {
      if (!this.supabase.debeSilenciarErrorOffline(error)) {
        await this.ui.showError('Error al cargar los datos');
      }
    }
  }

  // ──────────────────────────────
  // Getters BUS
  // ──────────────────────────────

  /**
   * Ventas del día = saldo que el sistema espera − saldo que la máquina muestra.
   * Solo se calcula cuando el usuario ingresó el saldo de la máquina.
   */
  get ventaBusCalculada(): number {
    if (this.saldoVirtualMaquina === null || this.saldoVirtualMaquina < 0) return 0;
    return Math.max(0, this.saldoVirtualSistemaBus - this.saldoVirtualMaquina);
  }

  /**
   * Total físico disponible para depositar:
   *   saldo acumulado en CAJA_BUS + ventas de hoy (aún no en CAJA_BUS)
   */
  get disponibleParaDepositar(): number {
    return this.saldoCajaBus + this.ventaBusCalculada;
  }

  /** true cuando el usuario ya ingresó el saldo de la máquina */
  get maquinaIngresada(): boolean {
    return this.saldoVirtualMaquina !== null && this.saldoVirtualMaquina >= 0;
  }

  get saldoBusInsuficiente(): boolean {
    if (this.tipo !== 'BUS' || !this.montoVirtual || this.montoVirtual <= 0) return false;
    // Si el usuario no ingresó la máquina, validar solo contra CAJA_BUS (comportamiento anterior)
    const limite = this.maquinaIngresada ? this.disponibleParaDepositar : this.saldoCajaBus;
    return this.montoVirtual > limite;
  }

  /**
   * Saldo de CAJA_BUS después del depósito.
   * Con mini cierre (maquinaIngresada + ventas > 0): incluye el INGRESO de ventas
   * que registra el SQL v3.0 antes del EGRESO → nunca queda negativo si pasa la validación.
   */
  get saldoBusDespues(): number {
    if (this.maquinaIngresada) {
      return this.saldoCajaBus + this.ventaBusCalculada - (this.montoVirtual ?? 0);
    }
    return this.saldoCajaBus - (this.montoVirtual ?? 0);
  }

  // ──────────────────────────────
  // Getters comunes
  // ──────────────────────────────

  get tituloModal(): string {
    return this.tipo === 'CELULAR' ? 'Registrar recarga' : 'Registrar depósito';
  }

  get subtituloModal(): string {
    return this.tipo === 'CELULAR'
      ? 'El proveedor te cargó saldo al celular'
      : 'Ya depositaste en el banco';
  }

  get labelMonto(): string {
    return this.tipo === 'CELULAR' ? '¿Cuánto te cargó el proveedor?' : '¿Cuánto vas a depositar?';
  }

  // ──────────────────────────────
  // Getters CELULAR
  // ──────────────────────────────

  get montoAPagar(): number {
    if (!this.montoVirtual || this.montoVirtual <= 0) return 0;
    return Math.round((this.montoVirtual * (1 - this.comisionPct / 100)) * 100) / 100;
  }

  get ganancia(): number {
    if (!this.montoVirtual || this.montoVirtual <= 0) return 0;
    return Math.round((this.montoVirtual * (this.comisionPct / 100)) * 100) / 100;
  }

  get mostrarCalculos(): boolean {
    return this.tipo === 'CELULAR' && !!this.montoVirtual && this.montoVirtual > 0;
  }

  // ──────────────────────────────
  // Acciones
  // ──────────────────────────────

  cerrar() {
    this.modalCtrl.dismiss();
  }

  async confirmar() {
    if (!this.montoVirtual || this.montoVirtual <= 0) {
      await this.ui.showError('Ingresa el monto');
      return;
    }
    if (this.guardando) return;
    this.guardando = true;

    try {
      const empleado = await this.authService.getUsuarioActual();
      if (!empleado) {
        await this.ui.showError('No se pudo obtener el empleado');
        return;
      }

      let resultado;

      if (this.tipo === 'CELULAR') {
        resultado = await this.service.registrarRecargaProveedorCelular({
          fecha: getFechaLocal(),
          empleado_id: empleado.id,
          monto_virtual: this.montoVirtual
        });

        if (!resultado?.success) {
          this.feedback.error({
            titulo: 'No se pudo registrar la recarga',
            subtitulo: 'Intenta de nuevo',
          });
          return;
        }

        // Overlay (no toast): el modal se cierra inmediatamente después — un toast
        // disparado justo antes de esa transición compite con ella y se pierde.
        this.feedback.success({
          titulo: 'Recarga registrada',
          destacado: `$${this.currencyService.format(resultado.monto_virtual)}`,
          subtitulo: `Debes $${this.currencyService.format(resultado.monto_a_pagar)} al proveedor · Ganancia $${this.currencyService.format(resultado.ganancia)}`,
        });

        this.modalCtrl.dismiss({ success: true, data: resultado });

      } else {
        // BUS — pasa saldo_virtual_maquina si fue ingresado (habilita validación extendida en SQL)
        resultado = await this.service.registrarCompraSaldoBus({
          fecha: getFechaLocal(),
          empleado_id: empleado.id,
          monto: this.montoVirtual,
          saldo_virtual_maquina: this.saldoVirtualMaquina ?? undefined
        });

        if (!resultado?.success) return;  // supabase.call() ya mostró el toast de error

        // Overlay (no toast): el modal se cierra inmediatamente después — ver nota
        // equivalente en la rama CELULAR.
        this.feedback.success({
          titulo: 'Depósito registrado',
          destacado: `$${this.currencyService.format(this.montoVirtual)}`,
        });
        this.modalCtrl.dismiss({ success: true });
      }
    } catch {
      // Errores ya los muestra supabase.call() — no duplicar toast
    } finally {
      this.guardando = false;
    }
  }
}

