import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalController } from '@ionic/angular/standalone';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkCircle, addCircleOutline, closeOutline } from 'ionicons/icons';
import { NegocioDisponible } from '../../../../features/auth/services/auth.service';
import { NegocioService } from '../../../../features/auth/services/negocio.service';
import { SuscripcionService } from '@core/services/suscripcion.service';
import { UiService } from '@core/services/ui.service';
import { EstadoSuscripcionResult } from '../../../../features/suscripcion/models/suscripcion.model';

// Límites de negocios por código de plan. Fuente de verdad: tabla `planes` en BD.
// Si cambian los límites, actualizar aquí y en la BD.
const LIMITE_NEGOCIOS: Record<string, number> = {
  PRO: 1,
  MAX: 3,
};

@Component({
  selector: 'app-selector-negocio-modal',
  templateUrl: './selector-negocio-modal.component.html',
  styleUrls: ['./selector-negocio-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonIcon]
})
export class SelectorNegocioModalComponent implements OnInit {
  private modalCtrl      = inject(ModalController);
  private negocioService = inject(NegocioService);
  private suscripcion    = inject(SuscripcionService);
  private ui             = inject(UiService);

  /** Negocio actualmente activo (para marcar el checkmark) */
  @Input() negocioActivoId = '';

  negocios: NegocioDisponible[] = [];
  loading = false;

  private estadoSuscripcion: EstadoSuscripcionResult | null = null;

  constructor() {
    addIcons({ checkmarkCircle, addCircleOutline, closeOutline });
  }

  async ngOnInit() {
    this.loading = true;
    try {
      // getEstado() usa cache — no genera un round-trip extra si ya fue consultado.
      [this.negocios, this.estadoSuscripcion] = await Promise.all([
        this.negocioService.getMisNegocios(),
        this.suscripcion.getEstado(),
      ]);
    } finally {
      this.loading = false;
    }
  }

  seleccionar(negocio: NegocioDisponible) {
    if (negocio.negocio_id === this.negocioActivoId) {
      this.cerrar();
      return;
    }
    this.modalCtrl.dismiss(negocio, 'seleccionar');
  }

  abrirCrearSucursal() {
    const plan = this.estadoSuscripcion?.plan_codigo ?? null;
    const limite = plan ? (LIMITE_NEGOCIOS[plan] ?? null) : null;

    // Sin plan activo o suscripción bloqueada: no puede crear
    if (!plan || this.estadoSuscripcion?.bloqueada) {
      this.ui.showToast(
        'Necesitas una suscripción activa para crear una sucursal.',
        'warning'
      );
      return;
    }

    // Plan sin soporte multi-negocio (PRO = 1 negocio)
    if (limite !== null && limite <= 1) {
      this.ui.showToast(
        `Tu plan ${plan} no incluye sucursales. Actualiza al plan MAX para gestionar hasta 3 negocios bajo una sola suscripción.`,
        'warning'
      );
      return;
    }

    // Plan MAX pero ya alcanzó el límite de negocios
    if (limite !== null && this.negocios.length >= limite) {
      this.ui.showToast(
        `Ya alcanzaste el límite de ${limite} negocios de tu plan ${plan}. Contacta al equipo si necesitas más.`,
        'warning'
      );
      return;
    }

    this.modalCtrl.dismiss(null, 'crear');
  }

  cerrar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  rolLegible(rol: string): string {
    return rol === 'ADMIN' ? 'Admin' : 'Empleado';
  }
}
