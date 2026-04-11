import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton,
  IonSpinner, IonSkeletonText, IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { storefrontOutline, walletOutline, busOutline, cartOutline } from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { UiService } from '@core/services/ui.service';
import { ConfigService } from '@core/services/config.service';
import { ConfiguracionService } from '../../services/configuracion.service';

type Seccion = 'negocio' | 'caja' | 'bus' | 'pos';

const CAMPOS_POR_SECCION: Record<Seccion, string[]> = {
  negocio: ['negocio_nombre'],
  caja:    ['caja_fondo_fijo_diario', 'caja_varios_transferencia_dia'],
  bus:     ['bus_alerta_saldo_bajo', 'bus_dias_antes_facturacion'],
  pos:     ['pos_descuentos_habilitados', 'pos_descuento_maximo_pct', 'pos_umbral_monto_descuento', 'pos_iva_porcentaje'],
};

const MENSAJES_SECCION: Record<Seccion, string> = {
  negocio: 'Datos del negocio guardados',
  caja:    'Parámetros de caja guardados',
  bus:     'Parámetros de bus guardados',
  pos:     'Configuración POS guardada',
};

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
export class ParametrosPage implements OnInit, OnDestroy {
  constructor() {
    addIcons({ storefrontOutline, walletOutline, busOutline, cartOutline });
  }

  private fb = inject(FormBuilder);
  private configuracionService = inject(ConfiguracionService);
  private configService = inject(ConfigService);
  private ui = inject(UiService);
  private sub!: Subscription;

  form!: FormGroup;
  cargando = true;

  guardando: Record<string, boolean> = {
    negocio: false, caja: false, bus: false, pos: false,
  };

  tieneCambios: Record<string, boolean> = {
    negocio: false, caja: false, bus: false, pos: false,
  };

  private savedValues: Record<string, Record<string, any>> = {};

  ngOnInit() {
    this.form = this.fb.group({
      negocio_nombre:               ['',   [Validators.required, Validators.maxLength(100)]],
      caja_fondo_fijo_diario:       [null, [Validators.required, Validators.min(0)]],
      caja_varios_transferencia_dia:[null, [Validators.required, Validators.min(0)]],
      bus_alerta_saldo_bajo:        [null, [Validators.required, Validators.min(0)]],
      bus_dias_antes_facturacion:   [null, [Validators.required, Validators.min(1)]],
      pos_descuentos_habilitados:   [false],
      pos_descuento_maximo_pct:     [null, [Validators.required, Validators.min(0), Validators.max(100)]],
      pos_umbral_monto_descuento:   [null, [Validators.required, Validators.min(0)]],
      pos_iva_porcentaje:           [null, [Validators.required, Validators.min(1), Validators.max(100)]]
    });

    this.cargarConfiguracion();
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  ionViewWillEnter() {
    this.ui.hideTabs();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  private snapshotSeccion(seccion: Seccion): Record<string, any> {
    const snap: Record<string, any> = {};
    for (const campo of CAMPOS_POR_SECCION[seccion]) {
      snap[campo] = this.form.value[campo];
    }
    return snap;
  }

  private guardarSnapshot() {
    for (const seccion of Object.keys(CAMPOS_POR_SECCION) as Seccion[]) {
      this.savedValues[seccion] = this.snapshotSeccion(seccion);
    }
  }

  private suscribirCambios() {
    this.sub = this.form.valueChanges.subscribe(() => {
      const anterior = this.tieneCambios;
      const nuevo: Record<string, boolean> = {};

      for (const seccion of Object.keys(CAMPOS_POR_SECCION) as Seccion[]) {
        const actual   = JSON.stringify(this.snapshotSeccion(seccion));
        const guardado = JSON.stringify(this.savedValues[seccion] ?? {});
        nuevo[seccion] = actual !== guardado;
      }

      this.tieneCambios = nuevo;

      // Scroll al botón guardar de la sección que acaba de tener cambios
      for (const seccion of Object.keys(nuevo) as Seccion[]) {
        if (nuevo[seccion] && !anterior[seccion]) {
          setTimeout(() => {
            document.getElementById(`footer-${seccion}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 50);
          break;
        }
      }
    });
  }

  private async cargarConfiguracion() {
    this.cargando = true;
    try {
      const config = await this.configuracionService.get();
      if (config) {
        this.form.patchValue({
          negocio_nombre:                config.negocio_nombre,
          caja_fondo_fijo_diario:        config.caja_fondo_fijo_diario,
          caja_varios_transferencia_dia: config.caja_varios_transferencia_dia,
          bus_alerta_saldo_bajo:         config.bus_alerta_saldo_bajo,
          bus_dias_antes_facturacion:    config.bus_dias_antes_facturacion,
          pos_descuentos_habilitados:    config.pos_descuentos_habilitados,
          pos_descuento_maximo_pct:      config.pos_descuento_maximo_pct,
          pos_umbral_monto_descuento:    config.pos_umbral_monto_descuento,
          pos_iva_porcentaje:            config.pos_iva_porcentaje
        }, { emitEvent: false });

        this.guardarSnapshot();
      }
    } catch {
      await this.ui.showError('Error al cargar los parámetros. Verificá tu conexión.');
    } finally {
      this.cargando = false;
      this.suscribirCambios();
    }
  }

  async guardarSeccion(seccion: Seccion) {
    if (this.guardando[seccion]) return;

    const campos = CAMPOS_POR_SECCION[seccion];
    campos.forEach(c => this.form.get(c)?.markAsTouched());
    if (campos.some(c => this.form.get(c)?.invalid)) return;

    this.guardando[seccion] = true;
    try {
      const valores: any = {};
      campos.forEach(c => {
        const val = this.form.value[c];
        if (c === 'negocio_nombre') valores[c] = (val ?? '').trim();
        else if (typeof val === 'boolean' || c.endsWith('_habilitado')) valores[c] = !!val;
        else valores[c] = Number(val);
      });

      const ok = await this.configuracionService.update(valores, MENSAJES_SECCION[seccion]);
      if (ok) {
        this.configService.invalidar();
        this.form.patchValue(valores, { emitEvent: false });
        this.savedValues[seccion] = this.snapshotSeccion(seccion);
        this.tieneCambios = { ...this.tieneCambios, [seccion]: false };
      }
    } catch {
      await this.ui.showError('Error al guardar. Verificá tu conexión.');
    } finally {
      this.guardando[seccion] = false;
    }
  }
}
