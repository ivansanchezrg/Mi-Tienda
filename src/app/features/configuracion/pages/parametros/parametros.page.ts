import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton,
  IonSpinner, IonSkeletonText, IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { storefrontOutline, walletOutline, archiveOutline, busOutline, cartOutline, peopleOutline, phonePortraitOutline, appsOutline } from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { UiService } from '@core/services/ui.service';
import { ConfigService } from '@core/services/config.service';
import { ConfiguracionService } from '../../services/configuracion.service';
import { AuthService } from '../../../auth/services/auth.service';
import { SupabaseService } from '@core/services/supabase.service';

type Seccion = 'negocio' | 'caja' | 'bus' | 'pos' | 'nomina';

const CAMPOS_POR_SECCION: Record<Seccion, string[]> = {
  negocio: ['negocio_nombre', 'negocio_telefono', 'negocio_direccion'],
  caja:    ['caja_fondo_fijo_diario', 'caja_varios_transferencia_dia'],
  bus:     ['bus_alerta_saldo_bajo', 'bus_dias_antes_facturacion'],
  pos:     ['pos_descuentos_habilitados', 'pos_descuento_maximo_pct', 'pos_umbral_monto_descuento', 'pos_iva_porcentaje'],
  nomina:  ['nomina_sueldo_base', 'nomina_dia_pago'],
};

const MENSAJES_SECCION: Record<Seccion, string> = {
  negocio: 'Datos del negocio guardados',
  caja:    'Parámetros de caja guardados',
  bus:     'Parámetros de bus guardados',
  pos:     'Configuración POS guardada',
  nomina:  'Configuración de nómina guardada',
};

@Component({
  selector: 'app-parametros',
  templateUrl: './parametros.page.html',
  styleUrls: ['./parametros.page.scss'],
  standalone: true,
  imports: [
    ReactiveFormsModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton,
    IonSpinner, IonSkeletonText, IonIcon
  ]
})
export class ParametrosPage implements OnInit, OnDestroy {
  constructor() {
    addIcons({ storefrontOutline, walletOutline, archiveOutline, busOutline, cartOutline, peopleOutline, phonePortraitOutline, appsOutline });
  }

  private fb = inject(FormBuilder);
  private configuracionService = inject(ConfiguracionService);
  private configService = inject(ConfigService);
  private authService = inject(AuthService);
  private supabase = inject(SupabaseService);
  private ui = inject(UiService);
  private sub!: Subscription;

  form!: FormGroup;
  cargando = true;
  esSuperadmin = false;
  esAdmin = false;
  recargasCelularHabilitada = false;
  recargasBusHabilitada     = false;
  variosActiva              = false;
  variosMonto               = 0;
  guardandoModulos          = false;

  get variosMontoInvalido(): boolean {
    return this.variosActiva && this.variosMonto <= 0;
  }

  guardando: Record<string, boolean> = {
    negocio: false, caja: false, bus: false, pos: false, nomina: false,
  };

  tieneCambios: Record<string, boolean> = {
    negocio: false, caja: false, bus: false, pos: false, nomina: false,
  };

  private savedValues: Record<string, Record<string, any>> = {};

  async ngOnInit() {
    const usuario = await this.authService.getUsuarioActual();
    this.esSuperadmin = usuario?.es_superadmin ?? false;
    this.esAdmin = usuario?.rol === 'ADMIN' || this.esSuperadmin;

    this.form = this.fb.group({
      negocio_nombre:               ['',   [Validators.required, Validators.maxLength(100)]],
      negocio_telefono:             ['',   [Validators.maxLength(20)]],
      negocio_direccion:            ['',   [Validators.maxLength(200)]],
      caja_fondo_fijo_diario:       [null, [Validators.required, Validators.min(0)]],
      caja_varios_transferencia_dia:[null, [Validators.required, Validators.min(0)]],
      bus_alerta_saldo_bajo:        [null, [Validators.required, Validators.min(0)]],
      bus_dias_antes_facturacion:   [null, [Validators.required, Validators.min(1)]],
      pos_descuentos_habilitados:   [false],
      pos_descuento_maximo_pct:     [null, [Validators.required, Validators.min(0), Validators.max(100)]],
      pos_umbral_monto_descuento:   [null, [Validators.required, Validators.min(0)]],
      pos_iva_porcentaje:           [null, [Validators.required, Validators.min(1), Validators.max(100)]],
      nomina_sueldo_base:           [null, [Validators.required, Validators.min(0)]],
      nomina_dia_pago:              [null, [Validators.required, Validators.min(1), Validators.max(31)]],
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
        this.recargasCelularHabilitada = config.recargas_celular_habilitada;
        this.recargasBusHabilitada     = config.recargas_bus_habilitada;
        this.variosActiva              = config.caja_varios_activa;
        this.variosMonto               = config.caja_varios_transferencia_dia ?? 0;
        this.form.patchValue({
          negocio_nombre:                config.negocio_nombre,
          negocio_telefono:              config.negocio_telefono,
          negocio_direccion:             config.negocio_direccion,
          caja_fondo_fijo_diario:        config.caja_fondo_fijo_diario,
          caja_varios_transferencia_dia: config.caja_varios_transferencia_dia,
          bus_alerta_saldo_bajo:         config.bus_alerta_saldo_bajo,
          bus_dias_antes_facturacion:    config.bus_dias_antes_facturacion,
          pos_descuentos_habilitados:    config.pos_descuentos_habilitados,
          pos_descuento_maximo_pct:      config.pos_descuento_maximo_pct,
          pos_umbral_monto_descuento:    config.pos_umbral_monto_descuento,
          pos_iva_porcentaje:            config.pos_iva_porcentaje,
          nomina_sueldo_base:            config.nomina_sueldo_base,
          nomina_dia_pago:               config.nomina_dia_pago,
        }, { emitEvent: false });

        this.guardarSnapshot();
      }
    } catch {
      await this.ui.showError('Error al cargar los parámetros. Verifica tu conexión.');
    } finally {
      this.cargando = false;
      this.suscribirCambios();
    }
  }

  async guardarModulos() {
    if (this.guardandoModulos) return;
    if (this.variosMontoInvalido) return;
    this.guardandoModulos = true;
    try {
      await this.supabase.call(
        this.supabase.client.rpc('fn_configurar_modulos', {
          p_celular:      this.recargasCelularHabilitada,
          p_bus:          this.recargasBusHabilitada,
          p_varios:       this.variosActiva,
          p_varios_monto: this.variosActiva ? this.variosMonto : 0
        }),
        'Módulos actualizados'
      );
      this.configService.invalidar();
    } catch {
      await this.ui.showError('Error al guardar los módulos.');
    } finally {
      this.guardandoModulos = false;
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
      const STRING_FIELDS = new Set(['negocio_nombre', 'negocio_telefono', 'negocio_direccion']);
      campos.forEach(c => {
        const val = this.form.value[c];
        if (STRING_FIELDS.has(c)) valores[c] = (val ?? '').trim();
        else if (typeof val === 'boolean' || c.endsWith('_habilitado') || c.endsWith('_habilitados')) valores[c] = !!val;
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
      await this.ui.showError('Error al guardar. Verifica tu conexión.');
    } finally {
      this.guardando[seccion] = false;
    }
  }
}
