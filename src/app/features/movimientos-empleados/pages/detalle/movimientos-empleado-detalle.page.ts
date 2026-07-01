import { Component, OnInit, inject, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonContent, IonHeader, IonTitle, IonToolbar,
  IonButtons, IonBackButton, IonIcon,
  IonButton,
  IonSkeletonText, IonRefresher, IonRefresherContent,
  IonInfiniteScroll, IonInfiniteScrollContent,
  ModalController, AlertController, NavController,
  ViewWillEnter, ViewWillLeave
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  walletOutline, chevronDownCircleOutline, personOutline,
  ellipsisVerticalOutline, cashOutline, createOutline,
  alertCircleOutline, starOutline, checkmarkCircleOutline,
  arrowUpOutline, arrowDownOutline, readerOutline, closeOutline,
  arrowForwardCircleOutline
} from 'ionicons/icons';
import { MovimientosEmpleadosService } from '../../services/movimientos-empleados.service';
import {
  MovimientoEmpleado, SaldoEmpleado, TIPO_MOVIMIENTO_CONFIG
} from '../../models/movimiento-empleado.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { ConfigService } from '../../../../core/services/config.service';
import { AuthService } from '../../../auth/services/auth.service';
import { formatFechaEC, formatHoraEC } from '../../../../core/utils/date.util';
import { PAGINATION_CONFIG } from '../../../../core/config/pagination.config';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';
import { AdelantoModalComponent } from '../../components/adelanto-modal/adelanto-modal.component';
import { AjusteModalComponent } from '../../components/ajuste-modal/ajuste-modal.component';
import { ROUTES } from '../../../../core/config/routes.config';
import { PagarNominaModalComponent } from '../../components/pagar-nomina-modal/pagar-nomina-modal.component';

@Component({
  selector: 'app-movimientos-empleado-detalle',
  templateUrl: './movimientos-empleado-detalle.page.html',
  styleUrls: ['./movimientos-empleado-detalle.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonContent, IonHeader, IonTitle, IonToolbar,
    IonButtons, IonBackButton, IonIcon,
    IonButton,
    IonSkeletonText, IonRefresher, IonRefresherContent,
    IonInfiniteScroll, IonInfiniteScrollContent,
    EmptyStateComponent
  ]
})
export class MovimientosEmpleadoDetallePage implements OnInit, ViewWillEnter, ViewWillLeave {

  @ViewChild('content') content!: IonContent;

  private route = inject(ActivatedRoute);
  private service = inject(MovimientosEmpleadosService);
  protected currencyService = inject(CurrencyService);
  private ui = inject(UiService);
  private configService = inject(ConfigService);
  private authService = inject(AuthService);
  private modalCtrl = inject(ModalController);
  private alertCtrl = inject(AlertController);
  private navCtrl = inject(NavController);
  private router = inject(Router);

  empleadoId = '';
  empleadoNombre = '';
  saldo = 0;
  movimientos: MovimientoEmpleado[] = [];
  loading = true;
  hasMore = true;
  verLiquidados = false;
  esSuperadmin = false;

  private page = 0;
  private readonly pageSize = PAGINATION_CONFIG.movimientosEmpleados.pageSize;

  readonly TIPO_CONFIG = TIPO_MOVIMIENTO_CONFIG;

  constructor() {
    addIcons({
      walletOutline, chevronDownCircleOutline, personOutline,
      ellipsisVerticalOutline, cashOutline, createOutline,
      alertCircleOutline, starOutline, checkmarkCircleOutline,
      arrowUpOutline, arrowDownOutline, readerOutline, closeOutline,
      arrowForwardCircleOutline
    });
  }

  async ngOnInit() {
    this.empleadoId = this.route.snapshot.paramMap.get('empleadoId') ?? '';
    const usuario = await this.authService.getUsuarioActual();
    this.esSuperadmin = usuario?.es_superadmin ?? false;
    await this.cargarDatos();
  }

  ionViewWillEnter() {
    this.ui.hideTabs();
    if (!this.loading) this.cargarDatos(true);
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  async cargarDatos(silencioso = false) {
    if (!silencioso) this.loading = true;
    this.page = 0;
    this.hasMore = true;

    try {
      const [empleado, movs] = await Promise.all([
        this.service.obtenerEmpleado(this.empleadoId),
        this.service.obtenerHistorialEmpleado(
          this.empleadoId, 0,
          this.verLiquidados ? undefined : 'PENDIENTE'
        )
      ]);

      if (!empleado) {
        await this.ui.showError('Empleado no encontrado');
        this.navCtrl.navigateBack(ROUTES.movimientosEmpleados.root);
        return;
      }

      this.empleadoNombre = empleado.nombre;
      this.saldo = empleado.saldo;
      this.movimientos = movs;
      this.hasMore = movs.length >= this.pageSize;
    } finally {
      this.loading = false;
    }
  }

  async cargarMas(event: CustomEvent) {
    this.page++;
    const movs = await this.service.obtenerHistorialEmpleado(
      this.empleadoId, this.page,
      this.verLiquidados ? undefined : 'PENDIENTE'
    );
    this.movimientos = [...this.movimientos, ...movs];
    this.hasMore = movs.length >= this.pageSize;
    (event.target as HTMLIonInfiniteScrollElement).complete();
  }

  async handleRefresh(event: CustomEvent) {
    await this.cargarDatos(true);
    (event.target as HTMLIonRefresherElement).complete();
  }

  async toggleLiquidados() {
    this.verLiquidados = !this.verLiquidados;
    await this.cargarDatos(true);
  }

  // ── Acciones ──

  async abrirMenuAcciones() {
    const config = await this.configService.get();
    if (config.nomina_sueldo_base <= 0) {
      await this.avisarSueldoSinConfigurar();
      return;
    }

    const groups: ModalOptionGroup[] = [{
      options: [
        { label: 'Dar adelanto', icon: 'cash-outline', value: 'adelanto' },
        { label: 'Pagar nomina', icon: 'checkmark-circle-outline', value: 'pagar' },
        { label: 'Ajustar cuenta', icon: 'create-outline', value: 'ajustar' },
      ]
    }, {
      options: [
        {
          label: this.verLiquidados ? 'Ocultar liquidados' : 'Ver historial completo',
          icon: 'reader-outline',
          value: 'toggle-liquidados'
        }
      ]
    }];

    const modal = await this.modalCtrl.create({
      component: OptionsModalComponent,
      componentProps: { title: 'Acciones', groups },
      cssClass: 'options-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();

    if (data === 'adelanto') await this.abrirAdelanto();
    else if (data === 'pagar') await this.abrirPagarNomina();
    else if (data === 'ajustar') await this.abrirAjustar();
    else if (data === 'toggle-liquidados') await this.toggleLiquidados();
  }

  /**
   * El onboarding deja nomina_sueldo_base en 0 a propósito (sin fricción de
   * captación) — Pagar nómina y Ajustar cuenta (modo "Falta") lo necesitan para
   * calcular el monto, y "Ajustar cuenta" ni siquiera bloquea al confirmar
   * (registraría un ajuste de $0 sin avisar). Se valida acá, antes de abrir el
   * menú de acciones, para no ofrecer opciones que de todos modos no van a
   * funcionar bien.
   */
  private async avisarSueldoSinConfigurar() {
    const alert = await this.alertCtrl.create({
      header: 'Falta configurar el sueldo base',
      message: 'Antes de gestionar nómina, configura el sueldo base en Parámetros → Nómina.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Ir a Parámetros',
          handler: () => this.router.navigate(
            [ROUTES.configuracion.parametros],
            { queryParams: { seccion: 'nomina' } }
          )
        }
      ]
    });
    await alert.present();
  }

  private async abrirAdelanto() {
    const modal = await this.modalCtrl.create({
      component: AdelantoModalComponent,
      componentProps: {
        empleadoId: this.empleadoId,
        empleadoNombre: this.empleadoNombre
      }
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data?.registrado) await this.cargarDatos(true);
  }

  private async abrirPagarNomina() {
    const modal = await this.modalCtrl.create({
      component: PagarNominaModalComponent,
      componentProps: {
        empleadoId: this.empleadoId,
        empleadoNombre: this.empleadoNombre
      }
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data?.registrado) await this.cargarDatos(true);
  }

  private async abrirAjustar() {
    const modal = await this.modalCtrl.create({
      component: AjusteModalComponent,
      componentProps: {
        empleadoId: this.empleadoId,
        empleadoNombre: this.empleadoNombre
      }
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data?.registrado) await this.cargarDatos(true);
  }

  // ── Helpers template ──

  formatFecha(iso: string): string { return formatFechaEC(iso); }
  formatHora(iso: string): string { return formatHoraEC(iso); }

  colorSaldo(saldo: number): string {
    if (saldo > 0) return 'success';
    if (saldo < 0) return 'danger';
    return 'medium';
  }

  labelSaldo(saldo: number): string {
    if (saldo > 0) return 'El negocio le debe';
    if (saldo < 0) return 'El empleado debe';
    return 'Al dia';
  }

  /** Signo efectivo del movimiento para display */
  signoEfectivo(mov: MovimientoEmpleado): '+' | '-' {
    return TIPO_MOVIMIENTO_CONFIG[mov.tipo_movimiento].signo as '+' | '-';
  }

  colorMovimiento(mov: MovimientoEmpleado): string {
    return TIPO_MOVIMIENTO_CONFIG[mov.tipo_movimiento].color;
  }
}
