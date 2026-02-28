import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonMenuButton,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonList, IonItem, IonIcon, IonLabel, IonSpinner,
  AlertController, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { settingsOutline, constructOutline, documentTextOutline, trashOutline } from 'ionicons/icons';
import { LoggerService } from '@core/services/logger.service';
import { UiService } from '@core/services/ui.service';
import { ConfiguracionService } from '../../services/configuracion.service';
import { LogsModalComponent } from '../../components/logs-modal/logs-modal.component';

@Component({
  selector: 'app-configuracion',
  templateUrl: './configuracion.page.html',
  styleUrls: ['./configuracion.page.scss'],
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonMenuButton,
    IonCard, IonCardHeader, IonCardTitle, IonCardContent,
    IonList, IonItem, IonIcon, IonLabel, IonSpinner
  ]
})
export class ConfiguracionPage implements OnInit {
  private fb                   = inject(FormBuilder);
  private configuracionService = inject(ConfiguracionService);
  private logger               = inject(LoggerService);
  private alertCtrl            = inject(AlertController);
  private modalCtrl            = inject(ModalController);
  private ui                   = inject(UiService);

  form!: FormGroup;
  cargando  = true;
  guardando = false;

  private configuracionId = '';

  constructor() {
    addIcons({ settingsOutline, constructOutline, documentTextOutline, trashOutline });
  }

  async ngOnInit() {
    this.form = this.fb.group({
      fondo_fijo_diario:               [null, [Validators.required, Validators.min(0)]],
      caja_chica_transferencia_diaria: [null, [Validators.required, Validators.min(0)]],
      bus_alerta_saldo_bajo:           [null, [Validators.required, Validators.min(0)]],
      bus_dias_antes_facturacion:      [null, [Validators.required, Validators.min(1)]]
    });

    await this.cargarConfiguracion();
  }

  private async cargarConfiguracion() {
    this.cargando = true;
    const config = await this.configuracionService.get();
    if (config) {
      this.configuracionId = config.id;
      this.form.patchValue({
        fondo_fijo_diario:               config.fondo_fijo_diario,
        caja_chica_transferencia_diaria: config.caja_chica_transferencia_diaria,
        bus_alerta_saldo_bajo:           config.bus_alerta_saldo_bajo,
        bus_dias_antes_facturacion:      config.bus_dias_antes_facturacion
      });
    }
    this.cargando = false;
  }

  async guardar() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.guardando = true;
    try {
      const updated = await this.configuracionService.update(this.configuracionId, {
        fondo_fijo_diario:               Number(this.form.value.fondo_fijo_diario),
        caja_chica_transferencia_diaria: Number(this.form.value.caja_chica_transferencia_diaria),
        bus_alerta_saldo_bajo:           Number(this.form.value.bus_alerta_saldo_bajo),
        bus_dias_antes_facturacion:      Number(this.form.value.bus_dias_antes_facturacion)
      });

      if (updated) {
        await this.ui.showSuccess('Configuración guardada');
      }
    } catch {
      await this.ui.showError('Error al guardar la configuración');
    } finally {
      this.guardando = false;
    }
  }

  async verLogs() {
    const modal = await this.modalCtrl.create({
      component: LogsModalComponent
    });
    await modal.present();
  }

  async limpiarLogs() {
    const alert = await this.alertCtrl.create({
      header: 'Limpiar Logs',
      message: '¿Estás seguro de que deseas eliminar todos los logs?',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Eliminar',
          role: 'destructive',
          handler: async () => {
            await this.logger.clearLogs();
            await this.ui.showSuccess('Logs eliminados');
          }
        }
      ]
    });
    await alert.present();
  }
}
