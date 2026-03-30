import { Component, inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton,
  IonSpinner, IonSkeletonText, IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { storefrontOutline, walletOutline, busOutline, cartOutline } from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { ConfigService } from '@core/services/config.service';
import { ConfiguracionService } from '../../services/configuracion.service';

@Component({
  selector: 'app-parametros',
  templateUrl: './parametros.page.html',
  styleUrls: ['./parametros.page.scss'],
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton,
    IonSpinner, IonSkeletonText, IonIcon
  ]
})
export class ParametrosPage implements OnInit {
  constructor() {
    addIcons({ storefrontOutline, walletOutline, busOutline, cartOutline });
  }

  private fb = inject(FormBuilder);
  private configuracionService = inject(ConfiguracionService);
  private configService = inject(ConfigService);
  private ui = inject(UiService);

  form!: FormGroup;
  cargando = true;
  guardando = false;

  ngOnInit() {
    this.form = this.fb.group({
      negocio_nombre: ['', [Validators.required, Validators.maxLength(100)]],
      caja_fondo_fijo_diario: [null, [Validators.required, Validators.min(0)]],
      caja_varios_transferencia_dia: [null, [Validators.required, Validators.min(0)]],
      bus_alerta_saldo_bajo: [null, [Validators.required, Validators.min(0)]],
      bus_dias_antes_facturacion: [null, [Validators.required, Validators.min(1)]],
      pos_descuentos_habilitados: [false],
      pos_descuento_maximo_pct: [null, [Validators.required, Validators.min(0), Validators.max(100)]],
      pos_umbral_monto_descuento: [null, [Validators.required, Validators.min(0)]]
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
        this.form.patchValue({
          negocio_nombre: config.negocio_nombre,
          caja_fondo_fijo_diario: config.caja_fondo_fijo_diario,
          caja_varios_transferencia_dia: config.caja_varios_transferencia_dia,
          bus_alerta_saldo_bajo: config.bus_alerta_saldo_bajo,
          bus_dias_antes_facturacion: config.bus_dias_antes_facturacion,
          pos_descuentos_habilitados: config.pos_descuentos_habilitados,
          pos_descuento_maximo_pct: config.pos_descuento_maximo_pct,
          pos_umbral_monto_descuento: config.pos_umbral_monto_descuento
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
      const ok = await this.configuracionService.update({
        negocio_nombre: (this.form.value.negocio_nombre ?? '').trim(),
        caja_fondo_fijo_diario: Number(this.form.value.caja_fondo_fijo_diario),
        caja_varios_transferencia_dia: Number(this.form.value.caja_varios_transferencia_dia),
        bus_alerta_saldo_bajo: Number(this.form.value.bus_alerta_saldo_bajo),
        bus_dias_antes_facturacion: Number(this.form.value.bus_dias_antes_facturacion),
        pos_descuentos_habilitados: !!this.form.value.pos_descuentos_habilitados,
        pos_descuento_maximo_pct: Number(this.form.value.pos_descuento_maximo_pct),
        pos_umbral_monto_descuento: Number(this.form.value.pos_umbral_monto_descuento)
      });

      if (ok) this.configService.invalidar();
    } catch {
      await this.ui.showError('Error al guardar los parámetros');
    } finally {
      this.guardando = false;
    }
  }
}
