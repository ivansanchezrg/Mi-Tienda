import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton, IonIcon,
  IonRefresher, IonRefresherContent, IonSkeletonText,
  ModalController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  shieldCheckmarkOutline, addOutline, createOutline, pricetagsOutline,
} from 'ionicons/icons';
import { AdminTabsComponent } from '../../components/admin-tabs/admin-tabs.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { PlanModalComponent } from '../../components/plan-modal/plan-modal.component';
import { AuthService } from '../../../auth/services/auth.service';
import { SuscripcionService } from '@core/services/suscripcion.service';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';
import { Plan } from '../../../suscripcion/models/suscripcion.model';

/** Mismas claves/labels que FEATURE_LABELS en suscripcion.page.ts y FEATURES_DISPONIBLES en plan-modal. */
const FEATURE_LABELS_CORTOS: Record<string, string> = {
  panel_financiero: 'Panel financiero',
  pos: 'POS',
  inventario: 'Inventario',
  ventas: 'Ventas',
  clientes: 'Clientes',
  empleados: 'Empleados',
  nomina: 'Nómina',
  notas: 'Notas',
  acciones_rapidas: 'Acciones rápidas',
  configuracion: 'Configuración',
  ia: 'IA',
};

/** Tab "Planes" del panel admin: CRUD del catálogo de planes. */
@Component({
  selector: 'app-admin-planes',
  templateUrl: './admin-planes.page.html',
  styleUrls: ['./admin-planes.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton, IonIcon,
    IonRefresher, IonRefresherContent, IonSkeletonText,
    AdminTabsComponent, EmptyStateComponent, AppCurrencyPipe,
  ],
})
export class AdminPlanesPage implements OnInit {
  private auth = inject(AuthService);
  private suscripcion = inject(SuscripcionService);
  private modalCtrl = inject(ModalController);

  loading = false;
  planes: Plan[] = [];

  constructor() {
    addIcons({ shieldCheckmarkOutline, addOutline, createOutline, pricetagsOutline });
  }

  async ngOnInit() {
    await this.cargar();
  }

  async cargar(silencioso = false) {
    if (!silencioso) this.loading = true;
    try {
      this.planes = await this.suscripcion.listarPlanes(false); // incluye inactivos
    } finally {
      this.loading = false;
    }
  }

  async handleRefresh(event: CustomEvent) {
    await this.cargar(true);
    (event.target as HTMLIonRefresherElement).complete();
  }

  /** Resumen legible de las features activas del plan. */
  featuresActivas(plan: Plan): string {
    const activas = Object.entries(plan.features ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => FEATURE_LABELS_CORTOS[k] ?? k);
    return activas.length ? activas.join(', ') : 'Sin funciones';
  }

  async nuevoPlan() {
    await this.abrirModal(null);
  }

  async editarPlan(plan: Plan) {
    await this.abrirModal(plan);
  }

  private async abrirModal(plan: Plan | null) {
    const modal = await this.modalCtrl.create({
      component: PlanModalComponent,
      componentProps: { plan },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();
    const { role } = await modal.onDidDismiss();
    if (role === 'confirm') await this.cargar(true);
  }

  async salir() {
    await this.auth.logout();
  }
}
