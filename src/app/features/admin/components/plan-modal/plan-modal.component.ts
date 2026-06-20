import { Component, Input, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import {
  IonButton, IonIcon, IonToggle, ModalController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { pricetagsOutline, closeOutline } from 'ionicons/icons';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { SuscripcionService } from '@core/services/suscripcion.service';
import { CurrencyService } from '@core/services/currency.service';
import { Plan, PlanFeatures } from '../../../suscripcion/models/suscripcion.model';

/**
 * Catálogo fijo de features que un plan puede habilitar.
 * Debe reflejar las mismas claves que FEATURE_LABELS en suscripcion.page.ts
 * (las que se muestran al cliente en "Planes y precios").
 */
const FEATURES_DISPONIBLES: Array<{ key: string; label: string }> = [
  { key: 'panel_financiero', label: 'Panel financiero en tiempo real' },
  { key: 'pos',              label: 'Punto de venta con escáner de productos' },
  { key: 'inventario',       label: 'Inventario con control de stock y kardex' },
  { key: 'ventas',           label: 'Historial de ventas y anulaciones' },
  { key: 'clientes',         label: 'Clientes, créditos y fiados' },
  { key: 'empleados',        label: 'Gestión de empleados y roles' },
  { key: 'nomina',           label: 'Nómina, adelantos y cuenta corriente de empleados' },
  { key: 'notas',            label: 'Notas compartidas entre el equipo' },
  { key: 'acciones_rapidas', label: 'Acciones rápidas (precio, margen de ganancia)' },
  { key: 'configuracion',    label: 'Configuración completa del negocio' },
  { key: 'ia',               label: 'Inteligencia artificial' },
];

/**
 * Modal crear/editar plan (superadmin). Bottom-sheet.
 * Las features se editan como toggles de un catálogo fijo (FEATURES_DISPONIBLES).
 */
@Component({
  selector: 'app-plan-modal',
  templateUrl: './plan-modal.component.html',
  styleUrls: ['./plan-modal.component.scss'],
  standalone: true,
  imports: [FormsModule, CommonModule, IonButton, IonIcon, IonToggle, CurrencyInputDirective],
})
export class PlanModalComponent implements OnInit {
  @Input() plan: Plan | null = null;

  private modalCtrl = inject(ModalController);
  private suscripcion = inject(SuscripcionService);
  private currency = inject(CurrencyService);

  readonly featuresDisponibles = FEATURES_DISPONIBLES;

  // Campos del formulario
  codigo = '';
  nombre = '';
  descripcion = '';
  precioMensualInput = '';
  precioAnualInput = '';   // vacío = el plan no ofrece pago anual (precio_anual NULL)
  trialDias = 0;
  maxNegociosInput = '';   // vacío = ilimitado (max_negocios NULL)
  orden = 0;
  activo = true;
  features: PlanFeatures = {};

  guardando = false;

  get esEdicion(): boolean {
    return !!this.plan;
  }

  constructor() {
    addIcons({ pricetagsOutline, closeOutline });
  }

  ngOnInit() {
    if (this.plan) {
      this.codigo = this.plan.codigo;
      this.nombre = this.plan.nombre;
      this.descripcion = this.plan.descripcion ?? '';
      this.precioMensualInput = this.currency.format(this.plan.precio_mensual);
      // precio_anual NULL → input vacío (el plan no ofrece anual).
      this.precioAnualInput = this.plan.precio_anual != null
        ? this.currency.format(this.plan.precio_anual)
        : '';
      this.trialDias = this.plan.trial_dias;
      // max_negocios NULL → input vacío (ilimitado).
      this.maxNegociosInput = this.plan.max_negocios != null ? String(this.plan.max_negocios) : '';
      this.orden = this.plan.orden;
      this.activo = this.plan.activo;
      this.features = { ...this.plan.features };
    }
  }

  /** True si el campo anual tiene un valor (el plan ofrecerá pago anual). */
  get tieneAnual(): boolean {
    return this.precioAnualInput.trim().length > 0
      && this.currency.parse(this.precioAnualInput) > 0;
  }

  toggleFeature(key: string, valor: boolean) {
    this.features = { ...this.features, [key]: valor };
  }

  get valido(): boolean {
    return this.codigo.trim().length > 0
      && this.nombre.trim().length > 0
      && this.currency.parse(this.precioMensualInput) >= 0
      && this.trialDias >= 0;
  }

  async confirmar() {
    if (!this.valido || this.guardando) return;
    this.guardando = true;
    try {
      const payload: Partial<Plan> = {
        ...(this.plan ? { id: this.plan.id } : {}),
        codigo: this.codigo.trim().toUpperCase(),
        nombre: this.nombre.trim(),
        descripcion: this.descripcion.trim() || null,
        precio_mensual: this.currency.parse(this.precioMensualInput),
        // Anual vacío o 0 → NULL (el plan no ofrece pago anual).
        precio_anual: this.tieneAnual ? this.currency.parse(this.precioAnualInput) : null,
        trial_dias: Number(this.trialDias) || 0,
        // Vacío o 0 → NULL (ilimitado).
        max_negocios: this.maxNegociosInput.trim() && Number(this.maxNegociosInput) > 0
          ? Number(this.maxNegociosInput)
          : null,
        orden: Number(this.orden) || 0,
        activo: this.activo,
        features: this.features,
      };
      const exito = await this.suscripcion.guardarPlan(payload);
      if (exito) await this.modalCtrl.dismiss(null, 'confirm');
    } finally {
      this.guardando = false;
    }
  }

  cerrar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
