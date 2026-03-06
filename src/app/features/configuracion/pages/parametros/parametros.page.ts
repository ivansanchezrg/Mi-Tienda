import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton,
  IonSpinner, IonSkeletonText
} from '@ionic/angular/standalone';
import { UiService } from '@core/services/ui.service';
import { ConfiguracionService } from '../../services/configuracion.service';

@Component({
  selector: 'app-parametros',
  templateUrl: './parametros.page.html',
  styleUrls: ['./parametros.page.scss'],
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton,
    IonSpinner, IonSkeletonText
  ]
})
export class ParametrosPage implements OnInit {
  private fb = inject(FormBuilder);
  private configuracionService = inject(ConfiguracionService);
  private ui = inject(UiService);

  form!: FormGroup;
  cargando = true;
  guardando = false;

  private configuracionId = '';

  ngOnInit() {
    this.form = this.fb.group({
      fondo_fijo_diario: [null, [Validators.required, Validators.min(0)]],
      caja_chica_transferencia_diaria: [null, [Validators.required, Validators.min(0)]],
      bus_alerta_saldo_bajo: [null, [Validators.required, Validators.min(0)]],
      bus_dias_antes_facturacion: [null, [Validators.required, Validators.min(1)]]
    });

    this.cargarConfiguracion();
  }

  ionViewWillEnter() {
    this.ui.hideTabs();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  private async cargarConfiguracion() {
    this.cargando = true;
    try {
      const config = await this.configuracionService.get();
      if (config) {
        this.configuracionId = config.id;
        this.form.patchValue({
          fondo_fijo_diario: config.fondo_fijo_diario,
          caja_chica_transferencia_diaria: config.caja_chica_transferencia_diaria,
          bus_alerta_saldo_bajo: config.bus_alerta_saldo_bajo,
          bus_dias_antes_facturacion: config.bus_dias_antes_facturacion
        });
      }
    } catch {
      await this.ui.showError('Error al cargar los parámetros. Verificá tu conexión.');
    } finally {
      this.cargando = false;
    }
  }

  async guardar() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.guardando = true;
    try {
      const updated = await this.configuracionService.update(this.configuracionId, {
        fondo_fijo_diario: Number(this.form.value.fondo_fijo_diario),
        caja_chica_transferencia_diaria: Number(this.form.value.caja_chica_transferencia_diaria),
        bus_alerta_saldo_bajo: Number(this.form.value.bus_alerta_saldo_bajo),
        bus_dias_antes_facturacion: Number(this.form.value.bus_dias_antes_facturacion)
      });

      if (updated) {
        await this.ui.showSuccess('Parámetros guardados');
      }
    } catch {
      await this.ui.showError('Error al guardar los parámetros');
    } finally {
      this.guardando = false;
    }
  }
}
