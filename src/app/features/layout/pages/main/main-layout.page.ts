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
import { BarcodeScannerService } from '@core/services/barcode-scanner.service';
import { ScannerOverlayComponent } from 'src/app/shared/components/scanner-overlay/scanner-overlay.component';

@Component({
  selector: 'app-main-layout',
  templateUrl: './main-layout.page.html',
  styleUrls: ['./main-layout.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonSplitPane, IonMenu, IonTabs, IonTabBar,
    IonTabButton, IonIcon, IonLabel,
    SidebarComponent, DisabledTabComponent, ScannerOverlayComponent
  ]
})
export class MainLayoutPage implements OnInit, OnDestroy {
  private ui = inject(UiService);
  private turnosCajaService = inject(TurnosCajaService);
  private modalCtrl = inject(ModalController);
  private notasService = inject(NotasService);
  private authService = inject(AuthService);
  private configService = inject(ConfigService);
  private scanner = inject(BarcodeScannerService);

  posHabilitado = false;
  posDisabledMessage = 'Para usar el POS primero abre la caja desde Inicio';
  esSuperadmin = false;
  // El cuadre solo tiene sentido con al menos un módulo de recargas activo
  cuadreDisponible = false;
  private posSub!: Subscription;
  private turnoSub!: Subscription;

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
  escaneandoPrecio = false;

  async ngOnInit() {
    // Invalidar al montar el layout (PRIMER consumidor de config en el arranque):
    // garantiza flags de módulos frescos desde BD para el FAB y para el sidebar,
    // que reusa esta misma carga. Si invalidara solo el sidebar (hijo), llegaría
    // tarde: se subiría a la carga stale de Preferences iniciada aquí.
    this.configService.invalidar();
    const [usuario, config] = await Promise.all([
      this.authService.getUsuarioActual(),
      this.configService.get()
    ]);
    this.esSuperadmin = usuario?.es_superadmin ?? false;
    this.cuadreDisponible = (config?.recargas_celular_habilitada ?? false)
                         || (config?.recargas_bus_habilitada ?? false);

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
  }

  ngOnDestroy() {
    this.posSub?.unsubscribe();
    this.turnoSub?.unsubscribe();
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
   * Nativo: escanea con la cámara y abre el bottom sheet con el resultado.
   * Web/desktop: abre el modal en modo manual — la pistola de escaneo (HID)
   * actúa como teclado y escribe el código en el input del modal.
   */
  async consultarPrecio() {
    this.fabAbierto = false;

    if (!this.scanner.isAvailable) {
      const modal = await this.modalCtrl.create({
        component: ConsultaPrecioModalComponent,
        cssClass: 'bottom-sheet-modal',
        breakpoints: [0, 1],
        initialBreakpoint: 1,
        // sin codigoInicial → modo manual
      });
      await modal.present();
      return;
    }

    this.escaneandoPrecio = true;
    try {
      const codigo = await this.scanner.scan();
      this.escaneandoPrecio = false;  // cerrar overlay antes de abrir el modal
      if (!codigo) return;

      const modal = await this.modalCtrl.create({
        component: ConsultaPrecioModalComponent,
        cssClass: 'bottom-sheet-modal',
        breakpoints: [0, 1],
        initialBreakpoint: 1,
        componentProps: { codigoInicial: codigo },
      });
      await modal.present();
      const { role } = await modal.onDidDismiss();

      // El usuario quiere consultar otro — volver a escanear
      if (role === 'rescanear') {
        await this.consultarPrecio();
      }
    } finally {
      this.escaneandoPrecio = false;
    }
  }

  cerrarEscaner() {
    this.scanner.stop();
    this.escaneandoPrecio = false;
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

