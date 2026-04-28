import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonContent, IonHeader, IonTitle, IonToolbar,
  IonButtons, IonBackButton, IonIcon,
  IonRefresher, IonRefresherContent,
  IonList, IonItem, IonLabel,
  IonSkeletonText,
  ViewWillEnter, ViewWillLeave
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  walletOutline, chevronForwardOutline, chevronDownCircleOutline,
  personOutline
} from 'ionicons/icons';
import { MovimientosEmpleadosService } from '../../services/movimientos-empleados.service';
import { SaldoEmpleado } from '../../models/movimiento-empleado.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { ROUTES } from '../../../../core/config/routes.config';

@Component({
  selector: 'app-movimientos-empleados-lista',
  templateUrl: './movimientos-empleados-lista.page.html',
  styleUrls: ['./movimientos-empleados-lista.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonContent, IonHeader, IonTitle, IonToolbar,
    IonButtons, IonBackButton, IonIcon,
    IonRefresher, IonRefresherContent,
    IonList, IonItem, IonLabel,
    IonSkeletonText,
    EmptyStateComponent
  ]
})
export class MovimientosEmpleadosListaPage implements OnInit, ViewWillEnter, ViewWillLeave {

  private service = inject(MovimientosEmpleadosService);
  public currencyService = inject(CurrencyService);
  private ui = inject(UiService);
  private router = inject(Router);

  empleados: SaldoEmpleado[] = [];
  loading = true;

  constructor() {
    addIcons({
      walletOutline, chevronForwardOutline, chevronDownCircleOutline,
      personOutline
    });
  }

  async ngOnInit() {
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
    try {
      this.empleados = await this.service.obtenerResumenCuentas();
    } finally {
      this.loading = false;
    }
  }

  async handleRefresh(event: CustomEvent) {
    await this.cargarDatos(true);
    (event.target as HTMLIonRefresherElement).complete();
  }

  abrirDetalle(empleado: SaldoEmpleado) {
    this.router.navigate([ROUTES.movimientosEmpleados.detalle(String(empleado.empleado_id))]);
  }

  /** Iniciales del nombre para el avatar */
  iniciales(nombre: string): string {
    if (!nombre?.trim()) return '?';
    return nombre
      .split(' ')
      .slice(0, 2)
      .map(p => p.charAt(0).toUpperCase())
      .join('');
  }

  /** Color del saldo segun signo */
  colorSaldo(saldo: number): string {
    if (saldo > 0) return 'success';  // negocio le debe
    if (saldo < 0) return 'danger';   // empleado debe
    return 'medium';
  }

  /** Label del saldo */
  labelSaldo(saldo: number): string {
    if (saldo > 0) return 'A favor';
    if (saldo < 0) return 'Debe';
    return 'Al dia';
  }

  get empleadosConSaldo(): number {
    return this.empleados.filter(e => e.saldo !== 0).length;
  }
}
