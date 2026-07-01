import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavController } from '@ionic/angular';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonSkeletonText,
  IonRefresher, IonRefresherContent,
  IonInfiniteScroll, IonInfiniteScrollContent,
  IonFab, IonFabButton,
  ModalController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowBackOutline, receiptOutline, chevronForwardOutline,
  checkmarkCircleOutline, chevronDownCircleOutline, arrowUpOutline,
} from 'ionicons/icons';
import { SuscripcionService } from '@core/services/suscripcion.service';
import { PAGINATION_CONFIG } from '@core/config/pagination.config';
import { ROUTES } from '@core/config/routes.config';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';
import { PaginatedListPage } from '@shared/pages/paginated-list.page';
import { EmptyStateComponent } from '@shared/components/empty-state/empty-state.component';
import { SuscripcionPago } from '../../models/suscripcion.model';
import { SuscripcionTabsComponent } from '../../components/suscripcion-tabs/suscripcion-tabs.component';

/**
 * Historial de pagos de la suscripción — estilo "Facturación" de Stripe/Claude:
 * fecha, monto, estado y acción "Ver" con el detalle completo en un modal.
 * Datos 100% de Supabase (tabla suscripcion_pagos); no hay pasarela de pago
 * conectada — el "Ver" muestra el detalle ya guardado, no un PDF descargable.
 */
@Component({
  selector: 'app-historial-pagos',
  templateUrl: './historial-pagos.page.html',
  styleUrls: ['./historial-pagos.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonSkeletonText,
    IonRefresher, IonRefresherContent,
    IonInfiniteScroll, IonInfiniteScrollContent,
    IonFab, IonFabButton,
    AppCurrencyPipe,
    EmptyStateComponent,
    SuscripcionTabsComponent,
  ],
})
export class HistorialPagosPage extends PaginatedListPage<SuscripcionPago> implements OnInit {
  private suscripcion = inject(SuscripcionService);
  private navCtrl = inject(NavController);
  private modalCtrl = inject(ModalController);

  get pagos(): SuscripcionPago[] { return this.items; }

  protected readonly pageSize = PAGINATION_CONFIG.historialPagosSuscripcion.pageSize;
  readonly loadingMoreText = 'Cargando más pagos...';

  constructor() {
    super();
    addIcons({ arrowBackOutline, receiptOutline, chevronForwardOutline, checkmarkCircleOutline, chevronDownCircleOutline, arrowUpOutline });
  }

  async ngOnInit() {
    await this.cargar();
  }

  protected async fetchPage(page: number): Promise<SuscripcionPago[]> {
    return this.suscripcion.listarPagos(page, this.pageSize);
  }

  async abrirDetalle(pago: SuscripcionPago) {
    const { DetallePagoModalComponent } = await import(
      '../../components/detalle-pago-modal/detalle-pago-modal.component'
    );
    const modal = await this.modalCtrl.create({
      component: DetallePagoModalComponent,
      componentProps: { pago },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();
  }

  /** Vuelve al home — la navegación entre Mi Plan/Historial ya la dan las tabs. */
  volver() {
    this.navCtrl.navigateBack(ROUTES.home);
  }
}
