import { Component, inject, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonCard, IonSpinner,
  IonInfiniteScroll, IonInfiniteScrollContent,
  ModalController, ActionSheetController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chevronBackOutline, arrowDownOutline, arrowUpOutline,
  lockOpenOutline, lockClosedOutline, createOutline,
  cashOutline, documentTextOutline, walletOutline,
  documentAttachOutline, closeOutline, ellipsisVertical, close
} from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { OperacionesCajaService } from '../../services/operaciones-caja.service';
import { OperacionCaja, FiltroFecha } from '../../models/operacion-caja.model';
import { UiService } from '@core/services/ui.service';
import { NetworkService } from '@core/services/network.service';
import { CajasService } from '../../services/cajas.service';
import { StorageService } from '@core/services/storage.service';
import { OperacionModalComponent, OperacionModalResult } from '../../components/operacion-modal/operacion-modal.component';

interface OperacionAgrupada {
  fecha: string;
  fechaDisplay: string;
  operaciones: OperacionCaja[];
  totalIngresos: number;
  totalEgresos: number;
}

@Component({
  selector: 'app-operaciones-caja',
  templateUrl: './operaciones-caja.page.html',
  styleUrls: ['./operaciones-caja.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonCard, IonSpinner,
    IonInfiniteScroll, IonInfiniteScrollContent
  ]
})
export class OperacionesCajaPage implements OnInit, OnDestroy {
  private router = inject(Router);
  private service = inject(OperacionesCajaService);
  private cajasService = inject(CajasService);
  private ui = inject(UiService);
  private modalCtrl = inject(ModalController);
  private storageService = inject(StorageService);
  private actionSheetCtrl = inject(ActionSheetController);
  private networkService = inject(NetworkService);
  private networkSub?: Subscription;

  @ViewChild(IonInfiniteScroll) infiniteScroll!: IonInfiniteScroll;

  cajaId: number = 0;
  cajaNombre: string = '';
  cajaSaldo: number = 0;

  operaciones: OperacionCaja[] = [];
  operacionesAgrupadas: OperacionAgrupada[] = [];
  filtro: FiltroFecha = 'hoy';
  page = 0;
  total = 0;
  hasMore = false;
  loading = false;

  // Resumen del período
  totalIngresos = 0;
  totalEgresos = 0;

  // Header con saldo
  showHeaderBalance = false;

  // Estado de conexión
  isOnline = true;

  constructor() {
    addIcons({
      chevronBackOutline, arrowDownOutline, arrowUpOutline,
      lockOpenOutline, lockClosedOutline, createOutline,
      cashOutline, documentTextOutline, walletOutline,
      documentAttachOutline, closeOutline, ellipsisVertical, close
    });

    const navigation = this.router.getCurrentNavigation();
    if (navigation?.extras?.state) {
      this.cajaId = navigation.extras.state['cajaId'];
      this.cajaNombre = navigation.extras.state['cajaNombre'];
    }
  }

  ngOnInit() {
    if (!this.cajaId) {
      this.router.navigate(['/home']);
      return;
    }
  }

  async ionViewWillEnter() {
    this.ui.hideTabs();

    // Suscribirse al estado de red (limpiar anterior si existe)
    this.networkSub?.unsubscribe();
    this.networkSub = this.networkService.getNetworkStatus().subscribe(isOnline => {
      this.isOnline = isOnline;
    });

    await this.cargarSaldoCaja();
    await this.cargarOperaciones(true);
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  ngOnDestroy() {
    this.networkSub?.unsubscribe();
  }

  async cargarSaldoCaja() {
    try {
      const cajas = await this.cajasService.obtenerCajas();
      if (cajas) {
        const caja = cajas.find(c => c.id === this.cajaId);
        if (caja) {
          this.cajaSaldo = caja.saldo_actual;
        }
      }
    } catch (error) {
      console.error('Error al cargar saldo:', error);
    }
  }

  async cargarOperaciones(reset = false) {
    if (reset) {
      this.page = 0;
      this.operaciones = [];
      this.totalIngresos = 0;
      this.totalEgresos = 0;
    }

    this.loading = true;

    try {
      const resultado = await this.service.obtenerOperacionesCaja(
        this.cajaId,
        this.filtro,
        this.page
      );

      if (reset) {
        this.operaciones = resultado.operaciones;
      } else {
        this.operaciones.push(...resultado.operaciones);
      }

      this.total = resultado.total;
      this.hasMore = resultado.hasMore;

      this.calcularResumen();
      this.agruparPorFecha();
    } catch (error: any) {
      await this.ui.showError(error.message || 'Error al cargar operaciones');
    } finally {
      this.loading = false;
    }
  }

  calcularResumen() {
    this.totalIngresos = 0;
    this.totalEgresos = 0;

    for (const op of this.operaciones) {
      if (this.esIngreso(op.tipo_operacion)) {
        this.totalIngresos += op.monto;
      } else if (this.esEgreso(op.tipo_operacion)) {
        this.totalEgresos += op.monto;
      }
    }
  }

  agruparPorFecha() {
    const grupos = new Map<string, OperacionAgrupada>();

    for (const op of this.operaciones) {
      const fecha = new Date(op.fecha);
      const fechaKey = fecha.toISOString().split('T')[0];

      if (!grupos.has(fechaKey)) {
        grupos.set(fechaKey, {
          fecha: fechaKey,
          fechaDisplay: this.formatFechaGrupo(fecha),
          operaciones: [],
          totalIngresos: 0,
          totalEgresos: 0
        });
      }

      const grupo = grupos.get(fechaKey)!;
      grupo.operaciones.push(op);

      if (this.esIngreso(op.tipo_operacion)) {
        grupo.totalIngresos += op.monto;
      } else if (this.esEgreso(op.tipo_operacion)) {
        grupo.totalEgresos += op.monto;
      }
    }

    this.operacionesAgrupadas = Array.from(grupos.values());
  }

  esIngreso(tipo: string): boolean {
    return ['INGRESO', 'TRANSFERENCIA_ENTRANTE', 'APERTURA'].includes(tipo);
  }

  esEgreso(tipo: string): boolean {
    return ['EGRESO', 'TRANSFERENCIA_SALIENTE', 'CIERRE'].includes(tipo);
  }

  async cambiarFiltro(event: any) {
    this.filtro = event.detail.value as FiltroFecha;
    await this.cargarOperaciones(true);
  }

  async cambiarFiltroDirecto(filtro: string) {
    this.filtro = filtro as FiltroFecha;
    await this.cargarOperaciones(true);
  }

  async loadMore(event: any) {
    this.page++;
    await this.cargarOperaciones(false);
    event.target.complete();
  }

  volver() {
    this.router.navigate(['/home']);
  }

  getOperacionIcon(tipo: string): string {
    const icons: Record<string, string> = {
      'INGRESO': 'arrow-down-outline',
      'EGRESO': 'arrow-up-outline',
      'TRANSFERENCIA_ENTRANTE': 'arrow-down-outline',
      'TRANSFERENCIA_SALIENTE': 'arrow-up-outline',
      'APERTURA': 'lock-open-outline',
      'CIERRE': 'lock-closed-outline',
      'AJUSTE': 'create-outline'
    };
    return icons[tipo] || 'cash-outline';
  }

  getOperacionColor(tipo: string): string {
    const colors: Record<string, string> = {
      'INGRESO': 'success',
      'EGRESO': 'danger',
      'TRANSFERENCIA_ENTRANTE': 'success',
      'TRANSFERENCIA_SALIENTE': 'danger',
      'APERTURA': 'primary',
      'CIERRE': 'medium',
      'AJUSTE': 'warning'
    };
    return colors[tipo] || 'medium';
  }

  getOperacionLabel(tipo: string): string {
    const labels: Record<string, string> = {
      'INGRESO': 'Ingreso',
      'EGRESO': 'Egreso',
      'TRANSFERENCIA_ENTRANTE': 'Transferencia recibida',
      'TRANSFERENCIA_SALIENTE': 'Transferencia enviada',
      'APERTURA': 'Apertura',
      'CIERRE': 'Cierre',
      'AJUSTE': 'Ajuste'
    };
    return labels[tipo] || tipo;
  }

  formatFechaGrupo(fecha: Date): string {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const ayer = new Date(hoy);
    ayer.setDate(ayer.getDate() - 1);

    const fechaDia = new Date(fecha);
    fechaDia.setHours(0, 0, 0, 0);

    if (fechaDia.getTime() === hoy.getTime()) {
      return 'Hoy';
    } else if (fechaDia.getTime() === ayer.getTime()) {
      return 'Ayer';
    }

    return fecha.toLocaleDateString('es', {
      weekday: 'long',
      day: 'numeric',
      month: 'short'
    });
  }

  formatHora(fecha: string): string {
    return new Date(fecha).toLocaleTimeString('es', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  onScroll(event: any) {
    // Mostrar saldo en header cuando el balance-card ya no es visible (~150px)
    this.showHeaderBalance = event.detail.scrollTop > 150;
  }

  async mostrarMenuOperaciones(event: Event) {
    event.stopPropagation();

    // Verificar conexión
    if (!this.isOnline) {
      await this.ui.showError('Sin conexión a internet. No puedes realizar operaciones.');
      return;
    }

    const actionSheet = await this.actionSheetCtrl.create({
      header: this.cajaNombre,
      cssClass: 'caja-action-sheet',
      buttons: [
        {
          text: 'Ingreso',
          icon: 'arrow-down-outline',
          cssClass: 'action-sheet-success',
          handler: () => {
            this.abrirModalOperacion('INGRESO');
          }
        },
        {
          text: 'Egreso',
          icon: 'arrow-up-outline',
          cssClass: 'action-sheet-danger',
          handler: () => {
            this.abrirModalOperacion('EGRESO');
          }
        },
        {
          text: 'Cancelar',
          icon: 'close',
          role: 'cancel',
          cssClass: 'action-sheet-cancel'
        }
      ]
    });

    await actionSheet.present();
  }

  async abrirModalOperacion(tipo: 'INGRESO' | 'EGRESO') {
    // Obtener lista de cajas para el modal
    const cajas = await this.cajasService.obtenerCajas();
    if (!cajas) return;

    const modal = await this.modalCtrl.create({
      component: OperacionModalComponent,
      componentProps: {
        tipo: tipo,
        cajas: cajas,
        cajaIdPreseleccionada: this.cajaId  // Pre-seleccionar la caja actual
      }
    });

    await modal.present();
    const { data, role } = await modal.onDidDismiss<OperacionModalResult>();

    if (role === 'confirm' && data) {
      await this.ejecutarOperacion(tipo, data);
    }
  }

  async ejecutarOperacion(tipo: 'INGRESO' | 'EGRESO', data: OperacionModalResult) {
    console.log('🔵 [ejecutarOperacion] Iniciando...', { tipo, data });

    const success = await this.service.registrarOperacion(
      data.cajaId,
      tipo,
      data.monto,
      data.descripcion,
      data.fotoComprobante
    );

    console.log('🔵 [ejecutarOperacion] Resultado:', { success });

    if (success) {
      console.log('✅ [ejecutarOperacion] Operación exitosa, recargando datos...');
      // Recargar saldo y operaciones
      await this.cargarSaldoCaja();
      await this.cargarOperaciones(true);
    } else {
      console.error('❌ [ejecutarOperacion] Operación falló');
    }
  }

  async verComprobante(path: string) {
    // Generar URL firmada desde el path
    await this.ui.showLoading('Cargando comprobante...');

    const signedUrl = await this.storageService.getSignedUrl(path);

    await this.ui.hideLoading();

    if (!signedUrl) {
      await this.ui.showError('No se pudo cargar el comprobante');
      return;
    }

    const modal = await this.modalCtrl.create({
      component: ComprobanteModalComponent,
      componentProps: { url: signedUrl },
      cssClass: 'comprobante-modal'
    });
    await modal.present();
  }
}

// ==========================================
// COMPONENTE INLINE: Modal de Comprobante
// ==========================================
@Component({
  selector: 'app-comprobante-modal',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Comprobante</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="cerrar()">
            <ion-icon slot="icon-only" name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div class="comprobante-container">
        <img [src]="url" alt="Comprobante" />
      </div>
    </ion-content>
  `,
  styles: [`
    .comprobante-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100%;
    }

    img {
      width: 100%;
      height: auto;
      max-width: 600px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
  `],
  standalone: true,
  imports: [
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon
  ]
})
class ComprobanteModalComponent {
  private modalCtrl = inject(ModalController);
  url: string = '';

  cerrar() {
    this.modalCtrl.dismiss();
  }
}
