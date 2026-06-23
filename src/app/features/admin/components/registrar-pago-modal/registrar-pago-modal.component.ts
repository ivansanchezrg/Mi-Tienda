import { Component, Input, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { cardOutline, closeOutline } from 'ionicons/icons';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { SuscripcionService } from '@core/services/suscripcion.service';
import { CurrencyService } from '@core/services/currency.service';
import { Plan, MetodoPago } from '../../../suscripcion/models/suscripcion.model';

/**
 * Modal para registrar un pago de suscripción (superadmin). Bottom-sheet.
 * Prellena el monto con el precio del plan; el método de pago sale del catálogo.
 * El pago es POR PROPIETARIO: renueva TODOS sus negocios a la vez (mismo plan,
 * periodo y vencimiento) vía fn_registrar_pago_propietario. Renueva desde el
 * vencimiento más próximo (1 clic).
 */
@Component({
  selector: 'app-registrar-pago-modal',
  templateUrl: './registrar-pago-modal.component.html',
  styleUrls: ['./registrar-pago-modal.component.scss'],
  standalone: true,
  imports: [FormsModule, IonButton, IonIcon, CurrencyInputDirective],
})
export class RegistrarPagoModalComponent implements OnInit {
  @Input() propietarioId!: string;
  @Input() propietarioNombre = '';
  /** Cuántos negocios renueva este pago (para mostrar el alcance al superadmin). */
  @Input() cantidadNegocios = 1;
  @Input() planCodigoActual: string | null = null;

  private modalCtrl = inject(ModalController);
  private suscripcion = inject(SuscripcionService);
  private currency = inject(CurrencyService);

  planes: Plan[] = [];
  metodos: MetodoPago[] = [];

  planId: string | null = null;
  metodoPagoId: string | null = null;
  periodo: 'MENSUAL' | 'ANUAL' = 'MENSUAL';
  montoInput = '';
  nota = '';

  cargando = true;
  guardando = false;

  constructor() {
    addIcons({ cardOutline, closeOutline });
  }

  async ngOnInit() {
    try {
      [this.planes, this.metodos] = await Promise.all([
        this.suscripcion.listarPlanes(true),
        this.suscripcion.listarMetodosPago(true),
      ]);
      const planVigente = this.planes.find(p => p.codigo === this.planCodigoActual) ?? this.planes[0];
      if (planVigente) {
        this.planId = planVigente.id;
        this.sincronizarMonto();
      }
      if (this.metodos.length) this.metodoPagoId = this.metodos[0].id;
    } finally {
      this.cargando = false;
    }
  }

  /** Texto del alcance del pago: deja claro al superadmin a cuántos negocios renueva. */
  get alcanceTexto(): string {
    return this.cantidadNegocios === 1
      ? `Renueva el negocio de ${this.propietarioNombre}`
      : `Renueva los ${this.cantidadNegocios} negocios de ${this.propietarioNombre}`;
  }

  /** Plan actualmente seleccionado en el formulario. */
  get planSeleccionado(): Plan | undefined {
    return this.planes.find(p => p.id === this.planId);
  }

  /** True si el plan seleccionado ofrece pago anual (precio_anual no nulo). */
  get planTieneAnual(): boolean {
    return this.planSeleccionado?.precio_anual != null;
  }

  /** Prellena el monto según el plan + periodo elegidos. */
  private sincronizarMonto() {
    const p = this.planSeleccionado;
    if (!p) return;
    const precio = this.periodo === 'ANUAL' && p.precio_anual != null
      ? p.precio_anual
      : p.precio_mensual;
    this.montoInput = this.currency.format(precio);
  }

  /** Cambio de plan: si el nuevo plan no ofrece anual, forzar mensual. */
  onPlanChange() {
    if (!this.planTieneAnual) this.periodo = 'MENSUAL';
    this.sincronizarMonto();
  }

  /** Cambio de periodo desde el toggle: reajusta el monto sugerido. */
  setPeriodo(periodo: 'MENSUAL' | 'ANUAL') {
    if (periodo === 'ANUAL' && !this.planTieneAnual) return;
    this.periodo = periodo;
    this.sincronizarMonto();
  }

  get valido(): boolean {
    return !!this.planId && !!this.metodoPagoId && this.currency.parse(this.montoInput) > 0;
  }

  async confirmar() {
    if (!this.valido || this.guardando) return;
    this.guardando = true;
    try {
      const exito = await this.suscripcion.registrarPagoPropietario({
        propietarioId: this.propietarioId,
        monto: this.currency.parse(this.montoInput),
        metodoPagoId: this.metodoPagoId,
        planId: this.planId,
        periodo: this.periodo,
        nota: this.nota.trim() || null,
      });
      if (exito) await this.modalCtrl.dismiss(null, 'confirm');
    } finally {
      this.guardando = false;
    }
  }

  cerrar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
