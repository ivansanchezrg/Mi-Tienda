import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonCard,
  ModalController, AlertController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, phonePortraitOutline, busOutline, arrowForwardOutline, alertCircleOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { SupabaseService } from '@core/services/supabase.service';
import { RecargasVirtualesService, RecargaVirtual } from '../../services/recargas-virtuales.service';
import { AuthService } from '../../../auth/services/auth.service';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';
import { CurrencyService } from '@core/services/currency.service';

type TipoServicio = 'CELULAR' | 'BUS';

@Component({
  selector: 'app-historial-modal',
  templateUrl: './historial-modal.component.html',
  styleUrls: ['./historial-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonCard,
    EmptyStateComponent,
    AppCurrencyPipe,
  ]
})
export class HistorialModalComponent implements OnInit {
  @Input() tipo: TipoServicio = 'CELULAR';
  @Input() cajaSaldo = 0;
  @Input() cajaVariosActiva = false;
  /**
   * Filas realmente liquidables (mismo dataset que alimenta el header de la página
   * padre: RecargasVirtualesService.obtenerPendientes() — pagado_proveedor=true AND
   * ganancia_liquidada=false). El total a transferir y el botón de liquidar SIEMPRE
   * se calculan desde aquí, nunca desde `historial` (que trae solo las últimas 50
   * filas de cualquier estado, sin filtrar pagado_proveedor — eso causaba que el
   * modal ofreciera liquidar ganancias que el proveedor aún no había pagado).
   */
  @Input() pendientes: RecargaVirtual[] = [];

  private modalCtrl = inject(ModalController);
  private alertCtrl = inject(AlertController);
  private ui = inject(UiService);
  private supabase = inject(SupabaseService);
  private service = inject(RecargasVirtualesService);
  private authService = inject(AuthService);
  private currencyService = inject(CurrencyService);

  loading = true;
  historial: RecargaVirtual[] = [];
  liquidado = false;

  constructor() {
    addIcons({ closeOutline, phonePortraitOutline, busOutline, arrowForwardOutline, alertCircleOutline });
  }

  async ngOnInit() {
    await this.cargarHistorial();
  }

  async cargarHistorial() {
    this.loading = true;
    try {
      this.historial = await this.service.obtenerHistorial(this.tipo);
    } catch (error) {
      if (!this.supabase.debeSilenciarErrorOffline(error)) {
        await this.ui.showError('Error al cargar el historial');
      }
    } finally {
      this.loading = false;
    }
  }

  get tituloModal(): string {
    return `Movimientos ${this.tipo === 'CELULAR' ? 'Celular' : 'Bus'}`;
  }

  get totalGanancia(): number {
    return Math.round(this.historial.reduce((s, r) => s + (r.ganancia ?? 0), 0) * 100) / 100;
  }

  get totalLiquidado(): number {
    return Math.round(this.historial.filter(r => r.ganancia_liquidada).reduce((s, r) => s + (r.ganancia ?? 0), 0) * 100) / 100;
  }

  /**
   * Total realmente liquidable — derivado de `pendientes` (ya filtrado correctamente
   * por el padre), no de `historial` (truncado a 50 filas y sin filtro pagado_proveedor).
   */
  get totalPorLiquidar(): number {
    return Math.round(this.pendientes.reduce((s, r) => s + (r.ganancia ?? 0), 0) * 100) / 100;
  }

  /**
   * Ganancia "atrapada" en filas CELULAR cuyo proveedor todavía no fue pagado
   * (pagado_proveedor=false). Esa ganancia no es liquidable hasta pagar al proveedor —
   * se calcula sobre `historial` (informativo, lista visible) solo para avisar al
   * usuario, nunca para decidir el monto a transferir (eso es `totalPorLiquidar`).
   * BUS no tiene esta etapa intermedia, por eso el aviso es exclusivo de CELULAR.
   */
  get gananciaSinPagarProveedor(): number {
    if (this.tipo !== 'CELULAR') return 0;
    return Math.round(
      this.historial
        .filter(r => !r.ganancia_liquidada && !r.pagado_proveedor)
        .reduce((s, r) => s + (r.ganancia ?? 0), 0) * 100
    ) / 100;
  }

  /**
   * Solo controla si HAY algo que liquidar — no exige saldo suficiente. El botón
   * debe verse siempre que haya ganancia pendiente; si la caja no alcanza, el propio
   * botón dispara el toast explicativo en confirmarLiquidacion() en vez de desaparecer
   * sin explicación (antes el usuario no tenía forma de saber por qué no aparecía).
   */
  get puedeLiquidar(): boolean {
    return this.totalPorLiquidar > 0;
  }

  get nombreCajaDestino(): string {
    return this.cajaVariosActiva ? 'Varios' : 'Tienda';
  }

  get nombreCajaOrigen(): string {
    return this.tipo === 'CELULAR' ? 'Caja Celular' : 'Caja Bus';
  }

  formatearFecha(fecha: string): string {
    const d = new Date(fecha + 'T00:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  async confirmarLiquidacion() {
    if (this.cajaSaldo < this.totalPorLiquidar) {
      await this.ui.showToast(
        `${this.nombreCajaOrigen} tiene $${this.currencyService.format(this.cajaSaldo)} y necesitas $${this.currencyService.format(this.totalPorLiquidar)} para liquidar.`,
        'warning'
      );
      return;
    }

    const alert = await this.alertCtrl.create({
      header: `Liquidar ganancia ${this.tipo === 'CELULAR' ? 'Celular' : 'Bus'}`,
      message: `Vas a transferir $${this.currencyService.format(this.totalPorLiquidar)} de ${this.nombreCajaOrigen} a ${this.nombreCajaDestino}.`,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Confirmar', handler: () => { this.ejecutarLiquidacion(); } }
      ]
    });
    await alert.present();
  }

  private async ejecutarLiquidacion() {
    const empleado = await this.authService.getUsuarioActual();
    if (!empleado) { await this.ui.showError('No se pudo obtener el empleado'); return; }

    const resultado = await this.service.liquidarGanancias(this.tipo, empleado.id);
    // null → supabase.call() ya mostró el toast con el motivo real (ej. "No hay
    // ganancias pendientes"). No mostrar un segundo toast genérico aquí.
    if (!resultado) return;

    await this.ui.showSuccess(resultado.message);
    this.liquidado = true;
    this.modalCtrl.dismiss({ liquidado: true });
  }

  cerrar() {
    this.modalCtrl.dismiss({ liquidado: this.liquidado });
  }
}
