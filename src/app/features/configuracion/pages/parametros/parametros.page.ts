import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton,
  IonSpinner, IonSkeletonText, IonIcon, AlertController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { storefrontOutline, archiveOutline, busOutline, cartOutline, peopleOutline, phonePortraitOutline, appsOutline, documentTextOutline } from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { UiService } from '@core/services/ui.service';
import { ConfigService } from '@core/services/config.service';
import { ConfiguracionService } from '../../services/configuracion.service';
import { AuthService } from '../../../auth/services/auth.service';
import { SupabaseService } from '@core/services/supabase.service';

// Sección 'negocio' ahora usa fn_actualizar_datos_negocio (tabla negocios).
// El resto de secciones siguen usando configuraciones (tabla configuraciones).
// La Caja Varios no está aquí: usa su propio flujo via fn_configurar_caja_varios
// (activa/desactiva la caja física + flag + monto en una sola transacción).
type Seccion = 'negocio' | 'sri' | 'bus' | 'pos' | 'nomina';

const CAMPOS_POR_SECCION: Record<Seccion, string[]> = {
  negocio: ['nombre', 'telefono', 'direccion', 'correo_electronico'],
  sri:     ['ruc', 'razon_social', 'nombre_comercial', 'codigo_establecimiento', 'codigo_punto_emision', 'ambiente_sri', 'obligado_contabilidad'],
  bus:     ['bus_alerta_saldo_bajo', 'bus_dias_antes_facturacion'],
  pos:     ['pos_descuentos_habilitados', 'pos_descuento_maximo_pct', 'pos_umbral_monto_descuento', 'pos_iva_porcentaje'],
  nomina:  ['nomina_sueldo_base', 'nomina_dia_pago'],
};

const MENSAJES_SECCION: Record<Seccion, string> = {
  negocio: 'Datos del negocio guardados',
  sri:     'Datos SRI guardados',
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
    addIcons({ storefrontOutline, archiveOutline, busOutline, cartOutline, peopleOutline, phonePortraitOutline, appsOutline, documentTextOutline });
  }

  private fb                   = inject(FormBuilder);
  private configuracionService = inject(ConfiguracionService);
  private configService        = inject(ConfigService);
  private authService          = inject(AuthService);
  private supabase             = inject(SupabaseService);
  private ui                   = inject(UiService);
  private alertCtrl            = inject(AlertController);
  private sub!: Subscription;
  private scrollTimeout?: ReturnType<typeof setTimeout>;

  form!: FormGroup;
  cargando                  = true;
  esSuperadmin              = false;
  esAdmin                   = false;
  recargasCelularHabilitada = false;
  recargasBusHabilitada     = false;
  guardandoModulos          = false;
  tipoComprobanteActual: 'TICKET' | 'NOTA_VENTA' | 'FACTURA' = 'TICKET';

  // Caja Varios — potestad del admin del negocio (fn_configurar_caja_varios).
  // Estado staged: el cambio se aplica al pulsar Guardar, no al mover el toggle.
  variosActiva          = false;
  variosMonto           = 0;
  variosActivaGuardada  = false;
  variosMontoGuardado   = 0;
  guardandoVarios       = false;

  get variosMontoInvalido(): boolean {
    return this.variosActiva && this.variosMonto <= 0;
  }

  get variosTieneCambios(): boolean {
    if (this.variosActiva !== this.variosActivaGuardada) return true;
    return this.variosActiva && Number(this.variosMonto) !== Number(this.variosMontoGuardado);
  }

  guardando: Record<string, boolean> = {
    negocio: false, sri: false, bus: false, pos: false, nomina: false,
  };

  tieneCambios: Record<string, boolean> = {
    negocio: false, sri: false, bus: false, pos: false, nomina: false,
  };

  private savedValues: Record<string, Record<string, any>> = {};

  async ngOnInit() {
    this.form = this.fb.group({
      // Sección negocio — tabla negocios
      nombre:               ['', [Validators.required, Validators.maxLength(255)]],
      telefono:             ['', [Validators.maxLength(20)]],
      direccion:            ['', [Validators.maxLength(200)]],
      correo_electronico:   ['', [Validators.maxLength(100), Validators.email]],
      // Sección SRI — tabla negocios
      ruc:                    ['', [Validators.maxLength(13), Validators.minLength(13), Validators.pattern(/^\d*$/)]],
      razon_social:           ['', [Validators.maxLength(300)]],
      nombre_comercial:       ['', [Validators.maxLength(300)]],
      codigo_establecimiento: ['001', [Validators.required, Validators.maxLength(3), Validators.pattern(/^\d{3}$/)]],
      codigo_punto_emision:   ['001', [Validators.required, Validators.maxLength(3), Validators.pattern(/^\d{3}$/)]],
      ambiente_sri:           [1],
      obligado_contabilidad:  [false],
      // Sección bus — tabla configuraciones
      bus_alerta_saldo_bajo:       [null, [Validators.required, Validators.min(0)]],
      bus_dias_antes_facturacion:  [null, [Validators.required, Validators.min(1)]],
      // Sección POS — tabla configuraciones
      pos_descuentos_habilitados:  [false],
      pos_descuento_maximo_pct:    [null, [Validators.required, Validators.min(0), Validators.max(100)]],
      pos_umbral_monto_descuento:  [null, [Validators.required, Validators.min(0)]],
      pos_iva_porcentaje:          [null, [Validators.required, Validators.min(1), Validators.max(100)]],
      // Sección nómina — tabla configuraciones
      nomina_sueldo_base: [null, [Validators.required, Validators.min(0)]],
      nomina_dia_pago:    [null, [Validators.required, Validators.min(1), Validators.max(31)]],
    });

    const [usuario] = await Promise.all([
      this.authService.getUsuarioActual(),
      this.cargarConfiguracion()
    ]);
    this.esSuperadmin = usuario?.es_superadmin ?? false;
    this.esAdmin      = usuario?.rol === 'ADMIN' || this.esSuperadmin;
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
    clearTimeout(this.scrollTimeout);
  }

  ionViewWillEnter() { this.ui.hideTabs(); }
  ionViewWillLeave() { this.ui.showTabs(); }

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

      for (const seccion of Object.keys(nuevo) as Seccion[]) {
        if (nuevo[seccion] && !anterior[seccion]) {
          clearTimeout(this.scrollTimeout);
          this.scrollTimeout = setTimeout(() => {
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
      const [config, datosNegocio] = await Promise.all([
        this.configuracionService.get(),
        this.configuracionService.getDatosNegocio()
      ]);

      if (datosNegocio) {
        this.form.patchValue({
          nombre:               datosNegocio.nombre             ?? '',
          telefono:             datosNegocio.telefono           ?? '',
          direccion:            datosNegocio.direccion          ?? '',
          correo_electronico:   datosNegocio.correo_electronico ?? '',
          ruc:                    datosNegocio.ruc                    ?? '',
          razon_social:           datosNegocio.razon_social           ?? '',
          nombre_comercial:       datosNegocio.nombre_comercial       ?? '',
          codigo_establecimiento: datosNegocio.codigo_establecimiento ?? '001',
          codigo_punto_emision:   datosNegocio.codigo_punto_emision   ?? '001',
          ambiente_sri:           datosNegocio.ambiente_sri           ?? 1,
          obligado_contabilidad:  datosNegocio.obligado_contabilidad  ?? false,
        }, { emitEvent: false });
      }

      if (config) {
        this.recargasCelularHabilitada = config.recargas_celular_habilitada;
        this.recargasBusHabilitada     = config.recargas_bus_habilitada;
        this.variosActiva              = config.caja_varios_activa;
        this.variosMonto               = config.caja_varios_transferencia_dia ?? 0;
        this.variosActivaGuardada      = this.variosActiva;
        this.variosMontoGuardado       = this.variosMonto;
        this.tipoComprobanteActual     = config.pos_tipo_comprobante;
        this.form.patchValue({
          bus_alerta_saldo_bajo:         config.bus_alerta_saldo_bajo,
          bus_dias_antes_facturacion:    config.bus_dias_antes_facturacion,
          pos_descuentos_habilitados:    config.pos_descuentos_habilitados,
          pos_descuento_maximo_pct:      config.pos_descuento_maximo_pct,
          pos_umbral_monto_descuento:    config.pos_umbral_monto_descuento,
          pos_iva_porcentaje:            config.pos_iva_porcentaje,
          nomina_sueldo_base:            config.nomina_sueldo_base,
          nomina_dia_pago:               config.nomina_dia_pago,
        }, { emitEvent: false });
      }

      this.guardarSnapshot();
    } catch {
      await this.ui.showError('Error al cargar los parámetros. Verifica tu conexión.');
    } finally {
      this.cargando = false;
      this.suscribirCambios();
    }
  }

  async guardarModulos() {
    if (this.guardandoModulos) return;
    this.guardandoModulos = true;
    try {
      await this.supabase.call(
        this.supabase.client.rpc('fn_configurar_modulos', {
          p_celular: this.recargasCelularHabilitada,
          p_bus:     this.recargasBusHabilitada
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

  /**
   * Activa/desactiva la Caja Varios via fn_configurar_caja_varios (potestad del admin).
   * Desactivar pide confirmación; la BD valida la salvaguarda (saldo debe ser $0)
   * y el toast muestra su mensaje si bloquea.
   */
  async guardarVarios() {
    if (this.guardandoVarios || this.variosMontoInvalido) return;

    const desactivando = this.variosActivaGuardada && !this.variosActiva;
    if (desactivando) {
      const alert = await this.alertCtrl.create({
        header: '¿Desactivar Caja Varios?',
        message: 'El cierre diario dejará de apartar dinero y la caja se ocultará del inicio. ' +
                 'Su historial se conserva y podrás activarla de nuevo cuando quieras. ' +
                 'Requiere que la caja tenga saldo $0.',
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          { text: 'Desactivar', role: 'destructive' }
        ]
      });
      await alert.present();
      const { role } = await alert.onDidDismiss();
      if (role !== 'destructive') return;
    }

    this.guardandoVarios = true;
    try {
      const resultado = await this.supabase.call(
        this.supabase.client.rpc('fn_configurar_caja_varios', {
          p_activar: this.variosActiva,
          p_monto:   this.variosActiva ? Number(this.variosMonto) : 0
        }),
        this.variosActiva ? 'Caja Varios activada' : 'Caja Varios desactivada'
      );

      // call() retorna null si hubo error (el toast ya se mostró con el mensaje de la BD,
      // p. ej. la salvaguarda de saldo > 0). Solo consolidar estado si fue exitoso.
      if (resultado !== null) {
        this.variosActivaGuardada = this.variosActiva;
        this.variosMontoGuardado  = this.variosMonto;
        this.configService.invalidar();
      } else {
        this.variosActiva = this.variosActivaGuardada;
        this.variosMonto  = this.variosMontoGuardado;
      }
    } finally {
      this.guardandoVarios = false;
    }
  }

  async guardarSeccion(seccion: Seccion) {
    if (this.guardando[seccion]) return;

    const campos = CAMPOS_POR_SECCION[seccion];
    campos.forEach(c => this.form.get(c)?.markAsTouched());
    if (campos.some(c => this.form.get(c)?.invalid)) return;

    this.guardando[seccion] = true;
    try {
      if (seccion === 'negocio' || seccion === 'sri') {
        // Datos de identidad → tabla negocios vía RPC
        const v = this.form.value;
        const datos: any = {};
        campos.forEach(c => {
          const val = v[c];
          if (typeof val === 'boolean') datos[c] = val;
          else if (c === 'ambiente_sri') datos[c] = Number(val);
          else datos[c] = (val ?? '').toString().trim() || null;
        });
        const ok = await this.configuracionService.actualizarDatosNegocio(datos, MENSAJES_SECCION[seccion]);
        if (ok) {
          this.savedValues[seccion] = this.snapshotSeccion(seccion);
          this.tieneCambios = { ...this.tieneCambios, [seccion]: false };
          // Si cambió el nombre, actualizar el cache local para que el sidebar lo refleje de inmediato
          if (seccion === 'negocio' && datos.nombre) {
            await this.authService.actualizarNombreNegocio(datos.nombre);
          }
        }
      } else {
        // Parámetros operativos → tabla configuraciones
        const valores: any = {};
        const STRING_FIELDS = new Set<string>([]);
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
      }
    } catch {
      await this.ui.showError('Error al guardar. Verifica tu conexión.');
    } finally {
      this.guardando[seccion] = false;
    }
  }
}
