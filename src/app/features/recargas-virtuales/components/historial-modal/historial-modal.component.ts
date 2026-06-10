import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonCard,
  ModalController, AlertController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, phonePortraitOutline, busOutline, arrowForwardOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { SupabaseService } from '@core/services/supabase.service';
import { RecargasVirtualesService, RecargaVirtual } from '../../services/recargas-virtuales.service';
import { AuthService } from '../../../auth/services/auth.service';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';

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
  @Input() esSuperadmin = false;

  private modalCtrl = inject(ModalController);
  private alertCtrl = inject(AlertController);
  private ui = inject(UiService);
  private supabase = inject(SupabaseService);
  private service = inject(RecargasVirtualesService);
  private authService = inject(AuthService);

  loading = true;
  historial: RecargaVirtual[] = [];
  liquidado = false;

  constructor() {
    addIcons({ closeOutline, phonePortraitOutline, busOutline, arrowForwardOutline });
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

  get totalPorLiquidar(): number {
    return Math.round(this.historial.filter(r => !r.ganancia_liquidada).reduce((s, r) => s + (r.ganancia ?? 0), 0) * 100) / 100;
  }

  get gananciasPendiente(): number {
    return this.totalPorLiquidar;
  }

  get puedeLiquidar(): boolean {
    return this.gananciasPendiente > 0 && this.cajaSaldo >= this.gananciasPendiente;
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
    if (this.cajaSaldo < this.gananciasPendiente) {
      await this.ui.showToast(
        `${this.nombreCajaOrigen} tiene $${this.cajaSaldo.toFixed(2)} y necesitas $${this.gananciasPendiente.toFixed(2)} para liquidar.`,
        'warning'
      );
      return;
    }

    const alert = await this.alertCtrl.create({
      header: `Liquidar ganancia ${this.tipo === 'CELULAR' ? 'Celular' : 'Bus'}`,
      message: `Vas a transferir $${this.gananciasPendiente.toFixed(2)} de ${this.nombreCajaOrigen} a ${this.nombreCajaDestino}.`,
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
    try {
      const resultado = await this.service.liquidarGanancias(this.tipo, empleado.id);
      await this.ui.showSuccess(resultado.message);
      this.liquidado = true;
      this.modalCtrl.dismiss({ liquidado: true });
    } catch (err: any) {
      await this.ui.showError(err?.message ?? 'Error al liquidar la ganancia');
    }
  }

  cerrar() {
    this.modalCtrl.dismiss({ liquidado: this.liquidado });
  }
}
