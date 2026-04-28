import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon, IonButton, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, arrowDownOutline, arrowUpOutline, calendarOutline,
  checkmarkCircleOutline, alertCircleOutline, createOutline
} from 'ionicons/icons';
import { MovimientosEmpleadosService } from '../../services/movimientos-empleados.service';
import { AuthService } from '../../../auth/services/auth.service';
import { CurrencyService } from '../../../../core/services/currency.service';
import { ConfigService } from '../../../../core/services/config.service';
import { getFechaLocal } from '../../../../core/utils/date.util';

type TipoAjuste = 'FALTA' | 'AJUSTE_CARGO' | 'AJUSTE_ABONO';

@Component({
  selector: 'app-ajuste-modal',
  templateUrl: './ajuste-modal.component.html',
  styleUrls: ['./ajuste-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonIcon, IonButton]
})
export class AjusteModalComponent implements OnInit {

  @Input() empleadoId!: string;
  @Input() empleadoNombre = '';

  private modalCtrl  = inject(ModalController);
  private service    = inject(MovimientosEmpleadosService);
  private authService= inject(AuthService);
  public  currency   = inject(CurrencyService);
  private config     = inject(ConfigService);

  // Tipo seleccionado
  tipo: TipoAjuste | null = null;

  // Campos del formulario
  montoRaw   = '';       // para cargo/abono manual
  descripcion= '';
  fechaFalta = getFechaLocal();  // YYYY-MM-DD, default hoy

  // Sueldo base leído de config (para calcular día de falta)
  sueldoBase = 0;

  // Estado
  guardando = false;
  errorMsg  = '';
  exito     = false;

  constructor() {
    addIcons({
      closeOutline, arrowDownOutline, arrowUpOutline, calendarOutline,
      checkmarkCircleOutline, alertCircleOutline, createOutline
    });
  }

  async ngOnInit() {
    const cfg = await this.config.get();
    this.sueldoBase = cfg.nomina_sueldo_base ?? 0;
  }

  // ── Getters ──

  get valorDia(): number {
    return this.sueldoBase > 0
      ? Math.round((this.sueldoBase / 30) * 100) / 100
      : 0;
  }

  get montoManual(): number {
    return this.currency.parse(this.montoRaw);
  }

  get montoFinal(): number {
    return this.tipo === 'FALTA' ? this.valorDia : this.montoManual;
  }

  get descripcionFinal(): string {
    if (this.tipo === 'FALTA') {
      const [y, m, d] = this.fechaFalta.split('-');
      const label = `${d}/${m}/${y}`;
      return this.descripcion.trim() || `Falta laboral — ${label}`;
    }
    return this.descripcion.trim();
  }

  get tipoMovimiento(): 'AJUSTE_CARGO' | 'AJUSTE_ABONO' {
    return this.tipo === 'AJUSTE_ABONO' ? 'AJUSTE_ABONO' : 'AJUSTE_CARGO';
  }

  get valido(): boolean {
    if (!this.tipo) return false;
    if (this.montoFinal <= 0) return false;
    if (this.tipo !== 'FALTA' && !this.descripcion.trim()) return false;
    return true;
  }

  seleccionar(t: TipoAjuste) {
    this.tipo = t;
    this.errorMsg = '';
  }

  // ── Acciones ──

  async confirmar() {
    if (!this.valido || this.guardando) return;
    this.guardando = true;
    this.errorMsg  = '';

    try {
      const usuario = await this.authService.getUsuarioActual();
      if (!usuario) return;

      const ok = await this.service.ajustarCuenta(
        this.empleadoId,
        this.montoFinal,
        this.tipoMovimiento,
        this.descripcionFinal,
        usuario.id
      );

      if (ok) {
        this.exito = true;
      } else {
        this.errorMsg = 'No se pudo registrar el ajuste. Intenta de nuevo.';
      }
    } finally {
      this.guardando = false;
    }
  }

  cerrar() {
    this.modalCtrl.dismiss(this.exito ? { registrado: true } : undefined);
  }
}
