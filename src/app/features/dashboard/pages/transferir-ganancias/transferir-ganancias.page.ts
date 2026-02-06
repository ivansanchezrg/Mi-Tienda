import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonCard, AlertController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chevronBackOutline, calendarOutline,
  phonePortraitOutline, busOutline, informationCircleOutline
} from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { GananciasPendientes } from '../../services/ganancias.service';
import { CajasService } from '../../services/cajas.service';
import { AuthService } from '../../../auth/services/auth.service';

@Component({
  selector: 'app-transferir-ganancias',
  templateUrl: './transferir-ganancias.page.html',
  styleUrls: ['./transferir-ganancias.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonCard
  ]
})
export class TransferirGananciasPage implements OnInit {
  private router = inject(Router);
  private ui = inject(UiService);
  private cajasService = inject(CajasService);
  private authService = inject(AuthService);
  private alertCtrl = inject(AlertController);

  ganancias: GananciasPendientes | null = null;

  constructor() {
    addIcons({
      chevronBackOutline, calendarOutline,
      phonePortraitOutline, busOutline, informationCircleOutline
    });

    // Obtener datos desde navigation state
    const navigation = this.router.getCurrentNavigation();
    if (navigation?.extras?.state) {
      this.ganancias = navigation.extras.state['ganancias'];
    }
  }

  ionViewWillEnter() {
    this.ui.hideTabs();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  ngOnInit() {
    // Si no hay ganancias, volver al home
    if (!this.ganancias) {
      this.router.navigate(['/home']);
    }
  }

  volver() {
    this.router.navigate(['/home']);
  }

  async confirmarTransferencia() {
    const alert = await this.alertCtrl.create({
      header: 'Confirmar Transferencia',
      message: `¿Moviste físicamente $${this.ganancias!.total.toFixed(2)} de las cajas de Celular y Bus a Caja Chica?`,
      buttons: [
        {
          text: 'Cancelar',
          role: 'cancel'
        },
        {
          text: 'Sí, confirmar',
          role: 'confirm',
          handler: async () => {
            await this.ejecutarTransferencia();
          }
        }
      ]
    });

    await alert.present();
  }

  private async ejecutarTransferencia() {
    if (!this.ganancias) return;

    await this.ui.showLoading('Registrando transferencia...');

    try {
      // Obtener empleado actual
      const empleado = await this.authService.getEmpleadoActual();
      if (!empleado) {
        throw new Error('No se pudo obtener el empleado actual');
      }

      // Crear transferencias en paralelo
      await Promise.all([
        // CAJA_CELULAR → CAJA_CHICA
        this.cajasService.crearTransferencia({
          cajaOrigenId: 3,
          cajaDestinoId: 2,
          monto: this.ganancias.gananciaCelular,
          empleadoId: empleado.id,
          descripcion: `Ganancia 5% ${this.ganancias.mes}`
        }),

        // CAJA_BUS → CAJA_CHICA
        this.cajasService.crearTransferencia({
          cajaOrigenId: 4,
          cajaDestinoId: 2,
          monto: this.ganancias.gananciaBus,
          empleadoId: empleado.id,
          descripcion: `Ganancia 1% ${this.ganancias.mes}`
        })
      ]);

      // Cerrar loading ANTES de navegar
      await this.ui.hideLoading();

      // Mostrar éxito
      await this.ui.showSuccess('Ganancias transferidas correctamente');

      // Delay antes de navegar
      await new Promise(resolve => setTimeout(resolve, 100));

      // Navegar al home con query param para refrescar
      await this.router.navigate(['/home'], {
        queryParams: { refresh: Date.now() }
      });
    } catch (error: any) {
      await this.ui.hideLoading();
      const mensaje = error?.message || 'Error al transferir ganancias';
      await this.ui.showError(mensaje);
    }
  }
}
