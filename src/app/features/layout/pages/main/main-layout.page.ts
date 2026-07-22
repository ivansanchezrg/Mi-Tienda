import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import {
  IonMenu, IonTabs, IonTabBar,
  IonTabButton, IonIcon, IonLabel,
  IonSplitPane, ModalController
} from '@ionic/angular/standalone';
import { SidebarComponent } from 'src/app/shared/components/sidebar/sidebar.component';
import { DisabledTabComponent } from 'src/app/shared/components/disabled-tab/disabled-tab.component';
import { addIcons } from 'ionicons';
import { homeOutline, cartOutline, cubeOutline, receiptOutline, add, close, barcodeOutline, createOutline, scaleOutline, calculatorOutline, pricetagOutline } from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { ConfigService } from '@core/services/config.service';
import { CuadreCajaPage } from 'src/app/features/caja/pages/cuadre-caja/cuadre-caja.page';
import { NuevaNotaModalComponent } from 'src/app/features/notas/components/nueva-nota-modal/nueva-nota-modal.component';
import { NotasService } from 'src/app/features/notas/services/notas.service';
import { AuthService } from 'src/app/features/auth/services/auth.service';
import { TurnosCajaService } from 'src/app/features/caja/services/turnos-caja.service';
import { CalculadoraMargenComponent } from 'src/app/shared/components/calculadora-margen/calculadora-margen.component';
import { ConsultaPrecioModalComponent } from 'src/app/shared/components/consulta-precio-modal/consulta-precio-modal.component';

@Component({
  selector: 'app-main-layout',
  templateUrl: './main-layout.page.html',
  styleUrls: ['./main-layout.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonSplitPane, IonMenu, IonTabs, IonTabBar,
    IonTabButton, IonIcon, IonLabel,
    SidebarComponent, DisabledTabComponent
  ]
})
export class MainLayoutPage implements OnInit, OnDestroy {
  private ui = inject(UiService);
  private turnosCajaService = inject(TurnosCajaService);
  private modalCtrl = inject(ModalController);
  private notasService = inject(NotasService);
  private authService = inject(AuthService);
  private configService = inject(ConfigService);

  posHabilitado = false;
  posDisabledMessage = 'Para usar el POS primero abre la caja desde Inicio';
  esSuperadmin = false;
  // El cuadre solo tiene sentido con al menos un módulo de recargas activo
  cuadreDisponible = false;
  private posSub!: Subscription;
  private turnoSub!: Subscription;
  private configSub?: Subscription;

  homeIcon = homeOutline;
  posIcon = barcodeOutline;
  ventasIcon = receiptOutline;
  inventarioIcon = cubeOutline;
  addIcon = add;
  closeIcon = close;
  createIcon = createOutline;
  scaleIcon = scaleOutline;
  calculatorIcon = calculatorOutline;
  priceIcon = pricetagOutline;

  constructor() {
    addIcons({ homeOutline, cartOutline, cubeOutline, receiptOutline, add, close, barcodeOutline, createOutline, scaleOutline, calculatorOutline, pricetagOutline });
  }

  // Estado del FAB
  fabAbierto = false;

  async ngOnInit() {
    // ── SUSCRIPCIONES PRIMERO (síncronas, antes de cualquier await) ──────────
    // Bug 2026-07-12: estas suscripciones se instalaban DESPUÉS del Promise.all
    // de abajo. Tras un reposo largo (>1h) el TTL del cache de config vence y
    // get() va a BD con la radio del teléfono recién despertando — ese await
    // colgaba segundos/minutos y, mientras tanto, posHabilitado quedaba en su
    // valor inicial (false): candado en el tab POS aunque esMiTurno$ ya era true
    // (TurnosCajaService hidrata local-first sin red). El Home, que no espera
    // este await, mostraba "caja abierta" a la vez — la contradicción reportada.
    // Todos los observables son BehaviorSubjects (o derivados de ellos): entregan
    // el último valor al suscribir, así que suscribir antes de hidratar no pierde
    // ninguna emisión.
    this.configSub = this.configService.config$.subscribe(cfg => {
      if (cfg) this.aplicarConfig(cfg);
    });

    // El POS solo se habilita para el empleado que abrio el turno.
    this.posSub = this.turnosCajaService.esMiTurno$.subscribe(esMio => {
      this.posHabilitado = esMio;
    });

    // Mensaje contextual del tab deshabilitado — se actualiza con el nombre
    // del empleado que tiene el turno, independiente del timing de esMiTurno$.
    this.turnoSub = this.turnosCajaService.turnoActivo$.subscribe(turno => {
      if (turno && !this.posHabilitado) {
        const nombre = turno.empleado?.nombre ?? 'otro empleado';
        this.posDisabledMessage = `${nombre} ya tiene el turno abierto. Solo ${nombre} puede usar el POS`;
      } else if (!turno) {
        this.posDisabledMessage = 'Para usar el POS primero abre la caja desde Inicio';
      }
    });

    // ── HIDRATACIÓN (I/O — puede tardar con red mala; ya no bloquea la UI) ───
    // Config local-first (2026-07-08): get() sirve del cache (RAM/Preferences) al
    // instante cuando el TTL está vigente. revalidar() trae la config real en
    // background y config$ re-emite: la suscripción de arriba re-aplica los flags.
    const [usuario, config] = await Promise.all([
      this.authService.getUsuarioActual(),
      this.configService.get()
    ]);
    this.esSuperadmin = usuario?.es_superadmin ?? false;
    this.aplicarConfig(config);
    this.configService.revalidar();
  }

  ngOnDestroy() {
    this.posSub?.unsubscribe();
    this.turnoSub?.unsubscribe();
    this.configSub?.unsubscribe();
  }

  /** Aplica los flags derivados de config. Se llama con el cache y con cada re-emisión de config$. */
  private aplicarConfig(config: { recargas_celular_habilitada?: boolean; recargas_bus_habilitada?: boolean } | null) {
    this.cuadreDisponible = (config?.recargas_celular_habilitada ?? false)
                         || (config?.recargas_bus_habilitada ?? false);
  }

/**
   * Toggle del estado del FAB
   */
  toggleFab() {
    this.fabAbierto = !this.fabAbierto;
  }

  /**
   * Handler de acciones rápidas del sidebar (desktop)
   */
  async onAccionRapida(accion: 'nueva-nota' | 'cuadre' | 'calculadora' | 'consulta-precio') {
    if (accion === 'nueva-nota') {
      await this.nuevaNota();
    } else if (accion === 'cuadre') {
      await this.irACuadre();
    } else if (accion === 'calculadora') {
      await this.abrirCalculadora();
    } else if (accion === 'consulta-precio') {
      await this.consultarPrecio();
    }
  }

  /**
   * Consulta de precio por código de barras.
   * Abre directamente el modal: el input (pistola HID / teclado) es la vía principal
   * y la cámara es un botón opcional dentro del modal (solo nativo). El escaneo lo
   * maneja el propio modal — mismo patrón que el catálogo del POS. Antes esto abría
   * la cámara de una en nativo; ahora el usuario decide cuándo usarla.
   */
  async consultarPrecio() {
    this.fabAbierto = false;

    const modal = await this.modalCtrl.create({
      component: ConsultaPrecioModalComponent,
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();
  }

  /**
   * Abre modal de cuadre de caja
   */
  async irACuadre() {
    this.fabAbierto = false;

    const modal = await this.modalCtrl.create({
      component: CuadreCajaPage,
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      keyboardClose: false
    });
    await modal.present();
  }

  /**
   * Abre el modal de nueva nota directamente desde el FAB
   */
  async abrirCalculadora() {
    this.fabAbierto = false;
    const modal = await this.modalCtrl.create({
      component: CalculadoraMargenComponent,
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
      keyboardClose: false
    });
    await modal.present();
  }

  async nuevaNota() {
    this.fabAbierto = false;
    const modal = await this.modalCtrl.create({
      component: NuevaNotaModalComponent,
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss<{ texto: string }>();
    if (role === 'confirm' && data?.texto) {
      const usuario = await this.authService.getUsuarioActual();
      if (usuario) {
        await this.notasService.crear(data.texto, usuario.id);
      }
    }
  }
}

