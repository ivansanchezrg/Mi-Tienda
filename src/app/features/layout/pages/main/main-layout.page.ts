import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import {
  IonMenu, IonTabs, IonTabBar,
  IonTabButton, IonIcon, IonLabel, IonFabButton,
  IonSplitPane, ModalController
} from '@ionic/angular/standalone';
import { SidebarComponent } from 'src/app/shared/components/sidebar/sidebar.component';
import { DisabledTabComponent } from 'src/app/shared/components/disabled-tab/disabled-tab.component';
import { homeOutline, cartOutline, cubeOutline, receiptOutline, add, close, barcodeOutline, createOutline, scaleOutline, calculatorOutline } from 'ionicons/icons';
import { UiService } from '@core/services/ui.service';
import { CuadreCajaPage } from 'src/app/features/dashboard/pages/cuadre-caja/cuadre-caja.page';
import { NuevaNotaModalComponent } from 'src/app/features/notas/components/nueva-nota-modal/nueva-nota-modal.component';
import { NotasService } from 'src/app/features/notas/services/notas.service';
import { AuthService } from 'src/app/features/auth/services/auth.service';
import { TurnosCajaService } from 'src/app/features/dashboard/services/turnos-caja.service';
import { CalculadoraMargenComponent } from 'src/app/shared/components/calculadora-margen/calculadora-margen.component';

@Component({
  selector: 'app-main-layout',
  templateUrl: './main-layout.page.html',
  styleUrls: ['./main-layout.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonSplitPane, IonMenu, IonTabs, IonTabBar,
    IonTabButton, IonIcon, IonLabel, IonFabButton,
    SidebarComponent, DisabledTabComponent
  ]
})
export class MainLayoutPage implements OnInit, OnDestroy {
  private ui = inject(UiService);
  private turnosCajaService = inject(TurnosCajaService);
  private modalCtrl = inject(ModalController);
  private notasService = inject(NotasService);
  private authService = inject(AuthService);

  /**
   * True si hay turno de caja abierto. Determina si el tab POS está habilitado.
   * Se sincroniza via Realtime con TurnosCajaService.cajaAbierta$.
   */
  posHabilitado = false;
  private posSub!: Subscription;

  homeIcon = homeOutline;
  posIcon = barcodeOutline;
  ventasIcon = receiptOutline;
  inventarioIcon = cubeOutline;
  addIcon = add;
  closeIcon = close;
  createIcon = createOutline;
  scaleIcon = scaleOutline;
  calculatorIcon = calculatorOutline;

  // Estado del FAB
  fabAbierto = false;

  async ngOnInit() {
    // El POS se habilita automaticamente cuando hay un turno de caja abierto.
    // TurnosCajaService sincroniza el estado via Realtime de la tabla turnos_caja.
    this.posSub = this.turnosCajaService.cajaAbierta$.subscribe(abierta => {
      this.posHabilitado = abierta;
    });
  }

  ngOnDestroy() {
    this.posSub?.unsubscribe();
  }

  get showTabs() { return this.ui.tabsVisible(); }

  /**
   * Toggle del estado del FAB
   */
  toggleFab() {
    this.fabAbierto = !this.fabAbierto;
  }

  /**
   * Handler de acciones rápidas del sidebar (desktop)
   */
  async onAccionRapida(accion: 'nueva-nota' | 'cuadre' | 'calculadora') {
    if (accion === 'nueva-nota') {
      await this.nuevaNota();
    } else if (accion === 'cuadre') {
      await this.irACuadre();
    } else if (accion === 'calculadora') {
      await this.abrirCalculadora();
    }
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

