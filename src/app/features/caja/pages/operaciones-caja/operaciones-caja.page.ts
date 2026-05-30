import { Component, inject, OnDestroy, ViewChild } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonCard,
  IonInfiniteScroll, IonInfiniteScrollContent,
  IonRefresher, IonRefresherContent,
  ModalController, AlertController, IonSkeletonText
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chevronBackOutline, arrowDownOutline, arrowUpOutline,
  lockOpenOutline, lockClosedOutline, createOutline,
  cashOutline, documentTextOutline, walletOutline,
  documentAttachOutline, closeOutline, ellipsisVertical, close,
  timeOutline
} from 'ionicons/icons';
import { CameraSource } from '@capacitor/camera';
import { Subscription } from 'rxjs';
import { OperacionesCajaService } from '../../services/operaciones-caja.service';
import { OperacionCaja, FiltroFecha } from '../../models/operacion-caja.model';
import { UiService } from '@core/services/ui.service';
import { NetworkService } from '@core/services/network.service';
import { CajasService } from '../../services/cajas.service';
import { StorageService } from '@core/services/storage.service';
import { OperacionModalComponent, OperacionModalResult } from '../../components/operacion-modal/operacion-modal.component';
import { NuevaCajaModalComponent } from '../../components/nueva-caja-modal/nueva-caja-modal.component';
import { OptionsMenuComponent, MenuOption } from '@shared/components/options-menu/options-menu.component';
import { AuthService } from '../../../auth/services/auth.service';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { OperacionLabelPipe } from '../../../../shared/pipes/operacion-label.pipe';
import { PeriodFilterComponent, PeriodOption } from '../../../../shared/components/period-filter/period-filter.component';
import { ROUTES } from '@core/config/routes.config';

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
    IonContent, IonIcon, IonCard,
    IonInfiniteScroll, IonInfiniteScrollContent, IonSkeletonText,
    IonRefresher, IonRefresherContent,
    EmptyStateComponent,
    PeriodFilterComponent,
    OptionsMenuComponent,
    OperacionLabelPipe
  ]
})
export class OperacionesCajaPage implements OnDestroy {
  private router = inject(Router);
  private service = inject(OperacionesCajaService);
  private cajasService = inject(CajasService);
  private ui = inject(UiService);
  private modalCtrl = inject(ModalController);
  private alertCtrl = inject(AlertController);
  private storageService = inject(StorageService);
  private networkService = inject(NetworkService);
  private route = inject(ActivatedRoute);
  private authService = inject(AuthService);
  private networkSub?: Subscription;
  private cajasSub?: Subscription;

  @ViewChild(IonInfiniteScroll) infiniteScroll!: IonInfiniteScroll;

  cajaId: string = '';
  cajaNombre: string = '';
  cajaSaldo: number = 0;

  operaciones: OperacionCaja[] = [];
  operacionesAgrupadas: OperacionAgrupada[] = [];
  filtro: FiltroFecha = 'hoy';

  readonly periodos: PeriodOption[] = [
    { value: 'hoy',    label: 'Hoy' },
    { value: 'semana', label: 'Semana' },
    { value: 'mes',    label: 'Mes' },
    { value: 'todas',  label: 'Todo' },
  ];

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

  // true si el turno activo de Caja Chica pertenece a otro empleado
  turnoAjeno = false;

  // true si el usuario logueado es quien abrió el turno de Caja Chica
  esMiTurno = false;

  // Código de la caja (CAJA, CAJA_CHICA, CAJA_CELULAR, CAJA_BUS, VARIOS)
  cajaCodigo = '';

  // true si el usuario logueado es ADMIN
  esAdmin = false;

  // El menú ⋮ siempre se muestra. Las opciones internas se filtran según
  // caja, rol y estado del turno (ver opcionesMenu).
  get mostrarMenuOpciones(): boolean {
    return true;
  }

  get opcionesMenu(): MenuOption[] {
    // Cajas digitales: solo edición
    const soloEditar = this.cajaCodigo === 'CAJA_CELULAR' || this.cajaCodigo === 'CAJA_BUS';
    if (soloEditar) {
      return [{ label: 'Editar caja', icon: 'create-outline', value: 'EDITAR' }];
    }

    // Cajón (CAJA_CHICA): ingreso/egreso solo en tu turno + historial siempre
    if (this.cajaCodigo === 'CAJA_CHICA') {
      const opciones: MenuOption[] = [];
      if (this.esMiTurno) {
        opciones.push(
          { label: 'Registrar Ingreso', icon: 'arrow-down-outline', value: 'INGRESO' },
          { label: 'Registrar Egreso',  icon: 'arrow-up-outline',   value: 'EGRESO',  color: 'danger' },
        );
      }
      opciones.push({ label: 'Historial de turnos', icon: 'time-outline', value: 'HISTORIAL_TURNOS' });
      if (this.esAdmin) {
        opciones.push({ label: 'Editar caja', icon: 'create-outline', value: 'EDITAR' });
      }
      return opciones;
    }

    // CAJA, VARIOS y custom: acciones completas
    return [
      { label: 'Registrar Ingreso', icon: 'arrow-down-outline', value: 'INGRESO' },
      { label: 'Registrar Egreso',  icon: 'arrow-up-outline',   value: 'EGRESO',  color: 'danger' },
      { label: 'Editar caja',       icon: 'create-outline',     value: 'EDITAR' },
    ];
  }

  constructor() {
    addIcons({
      chevronBackOutline, arrowDownOutline, arrowUpOutline,
      lockOpenOutline, lockClosedOutline, createOutline,
      cashOutline, documentTextOutline, walletOutline,
      documentAttachOutline, closeOutline, ellipsisVertical, close,
      timeOutline
    });
  }

  async ionViewWillEnter() {
    // Leer queryParams aquí (no en ngOnInit) para que se actualicen
    // cada vez que se navega a esta página con una caja diferente.
    // IonicRouteStrategy cachea la página — ngOnInit solo se ejecuta una vez.
    const params = this.route.snapshot.queryParams;
    this.cajaId     = params['cajaId']     || '';
    this.cajaNombre = params['cajaNombre'] || '';
    this.cajaCodigo = params['cajaCodigo'] || '';
    this.turnoAjeno = params['turnoAjeno'] === 'true';
    this.esMiTurno  = params['esMiTurno']  === 'true';

    if (!this.cajaId) {
      this.router.navigate([ROUTES.home]);
      return;
    }

    this.ui.hideTabs();

    const usuario = await this.authService.getUsuarioActual();
    this.esAdmin = usuario?.rol === 'ADMIN';

    this.networkSub?.unsubscribe();
    this.networkSub = this.networkService.getNetworkStatus().subscribe(isOnline => {
      this.isOnline = isOnline;
    });

    // Actualizar cajaSaldo en tiempo real cuando cambia desde otro dispositivo
    this.cajasSub?.unsubscribe();
    this.cajasSub = this.cajasService.cajas$.subscribe(cajas => {
      const caja = cajas.find(c => c.id === this.cajaId);
      if (caja) this.cajaSaldo = caja.saldo_actual;
    });

    await this.cargarOperaciones(true);
  }

  ionViewWillLeave() {
    this.ui.showTabs();
    this.cajasSub?.unsubscribe();
    this.cajasSub = undefined;
  }

  ngOnDestroy() {
    this.networkSub?.unsubscribe();
    this.cajasSub?.unsubscribe();
  }

  async cargarOperaciones(reset = false, isRefresh = false) {
    if (reset) {
      this.page = 0;
      if (!isRefresh) {
        this.operaciones = [];
        this.totalIngresos = 0;
        this.totalEgresos = 0;
      }
    }

    if (!isRefresh) {
      this.loading = true;
    }

    try {
      const resultado = await this.service.obtenerOperacionesCaja(this.cajaId, this.filtro, this.page);

      // cajaSaldo ya se actualiza via cajasSub (Realtime) — solo asignar en carga inicial
      const caja = this.cajasService.cajasValue.find(c => c.id === this.cajaId);
      if (caja) this.cajaSaldo = caja.saldo_actual;

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
      if (this.esIngresoReal(op.tipo_operacion)) {
        this.totalIngresos += op.monto;
      } else if (this.esEgresoReal(op.tipo_operacion)) {
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

      if (this.esIngresoReal(op.tipo_operacion)) {
        grupo.totalIngresos += op.monto;
      } else if (this.esEgresoReal(op.tipo_operacion)) {
        grupo.totalEgresos += op.monto;
      }
    }

    this.operacionesAgrupadas = Array.from(grupos.values());
  }

  // Resumen del período: incluye todo lo que sumó/restó al saldo de la caja.
  // CIERRE cuenta como ingreso porque es dinero que entró a la caja.
  // APERTURA y AJUSTE son neutros (no suman a ingresos ni egresos).
  private esIngresoReal(tipo: string): boolean {
    return ['INGRESO', 'TRANSFERENCIA_ENTRANTE', 'CIERRE'].includes(tipo);
  }

  private esEgresoReal(tipo: string): boolean {
    return ['EGRESO', 'TRANSFERENCIA_SALIENTE'].includes(tipo);
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
    this.router.navigate([ROUTES.home]);
  }



  formatFechaGrupo(fecha: Date): string {
    return fecha.toLocaleDateString('es', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
  }

  formatHora(fecha: string): string {
    return new Date(fecha).toLocaleTimeString('es', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  async handleRefresh(event: CustomEvent) {
    await this.cargarOperaciones(true, true);
    (event.target as HTMLIonRefresherElement).complete();
  }

  onScroll(event: any) {
    // Mostrar saldo en header cuando el balance-card ya no es visible (~150px)
    this.showHeaderBalance = event.detail.scrollTop > 150;
  }

  async onMenuOpcion(option: MenuOption) {
    if (option.value === 'EDITAR') {
      this.abrirModalEditar();
      return;
    }
    if (option.value === 'HISTORIAL_TURNOS') {
      this.router.navigate([ROUTES.caja.historialTurnos]);
      return;
    }
    if (!this.isOnline) {
      await this.ui.showError('Sin conexión a internet. No puedes realizar operaciones.');
      return;
    }
    this.abrirModalOperacion(option.value as 'INGRESO' | 'EGRESO');
  }

  async abrirModalEditar() {
    const cajas = await this.cajasService.obtenerCajas();
    const cajaActual = cajas.find(c => c.id === this.cajaId);
    if (!cajaActual) return;

    const modal = await this.modalCtrl.create({
      component: NuevaCajaModalComponent,
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      componentProps: {
        cajasExistentes: cajas,
        cajaEditar: cajaActual,
      },
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss();
    if (role === 'confirm' && data) {
      this.cajaNombre = data.nombre;
      await this.cargarOperaciones(true);
    }
  }

  async abrirModalOperacion(tipo: 'INGRESO' | 'EGRESO') {
    try {
      const cajas = await this.cajasService.obtenerCajas();
      if (!cajas) return;

      const modal = await this.modalCtrl.create({
        component: OperacionModalComponent,
        componentProps: {
          tipo: tipo,
          cajas: cajas,
          cajaIdPreseleccionada: this.cajaId
        },
        cssClass: 'bottom-sheet-modal',
        breakpoints: [0, 1],
        initialBreakpoint: 1
      });

      await modal.present();
      const { data, role } = await modal.onDidDismiss<OperacionModalResult>();

      if (role === 'confirm' && data) {
        await this.ejecutarOperacion(tipo, data);
      }
    } catch (error: any) {
      await this.ui.showError('Error al abrir el formulario. Verifica tu conexión.');
    }
  }

  async ejecutarOperacion(tipo: 'INGRESO' | 'EGRESO', data: OperacionModalResult) {
    const success = await this.service.registrarOperacion(
      data.cajaId,
      tipo,
      data.categoriaId,
      data.monto,
      data.descripcion,
      data.fotoComprobante
    );

    if (success) {
      await this.cargarOperaciones(true);
    }
  }

  async abrirOpcionesComprobante(op: OperacionCaja) {
    const buttons: any[] = [
      { text: 'Ver comprobante', handler: () => this.verComprobante(op.comprobante_url!) }
    ];
    if (this.storageService.isNative) {
      buttons.push({ text: 'Cambiar foto', handler: () => this.cambiarComprobante(op, CameraSource.Camera) });
    }
    buttons.push({ text: 'Cambiar desde galería', handler: () => this.cambiarComprobante(op, CameraSource.Photos) });
    buttons.push({ text: 'Cancelar', role: 'cancel' });

    const alert = await this.alertCtrl.create({ header: 'Comprobante', buttons });
    await alert.present();
  }

  private async verComprobante(path: string) {
    try {
      await this.ui.showLoading('Cargando comprobante...');
      const signedUrl = await this.storageService.getSignedUrl(path);
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
    } catch {
      await this.ui.showError('Error al cargar el comprobante');
    } finally {
      await this.ui.hideLoading();
    }
  }

  private async cambiarComprobante(op: OperacionCaja, source: CameraSource) {
    const result = await this.storageService.capturarFoto(source);
    if (!result) return;

    await this.ui.showLoading('Actualizando comprobante...');
    try {
      const ok = await this.service.actualizarComprobante(op.id, result.rawUrl, op.comprobante_url ?? null);
      if (ok) {
        await this.ui.showSuccess('Comprobante actualizado');
        await this.cargarOperaciones(true);
      }
    } finally {
      await this.ui.hideLoading();
    }
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
