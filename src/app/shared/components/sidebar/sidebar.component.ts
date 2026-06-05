import { Component, inject, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { Subscription } from 'rxjs';
import { RouterModule, Router } from '@angular/router';
import {
  IonList, IonItem, IonIcon, IonLabel,
  IonMenuToggle, IonButton
} from '@ionic/angular/standalone';
import { MenuController, ModalController } from '@ionic/angular/standalone';
import {
  peopleOutline, settingsOutline, logOutOutline, personCircleOutline,
  listOutline, swapHorizontalOutline, homeOutline, cubeOutline,
  personOutline, readerOutline, barcodeOutline, receiptOutline,
  storefrontOutline, calculatorOutline, createOutline, scaleOutline,
  walletOutline, shieldCheckmarkOutline, arrowBackOutline, chevronDownOutline,
  lockClosedOutline
} from 'ionicons/icons';
import { AuthService } from '../../../features/auth/services/auth.service';
import { RolUsuario } from '../../../features/auth/models/usuario-actual.model';
import { TurnosCajaService } from '../../../features/caja/services/turnos-caja.service';
import { UiService } from '@core/services/ui.service';
import { ConfigService } from '@core/services/config.service';
import { addIcons } from 'ionicons';
import { ROUTES } from '@core/config/routes.config';

interface MenuItem {
  title: string;
  url: string;
  icon: string;
  exact?: boolean;
  soloAdmin?: boolean;
  soloPos?: boolean;
  soloRecargas?: boolean;
  disabled?: boolean;
}

interface MenuGroup {
  label?: string;
  items: MenuItem[];
}

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
  standalone: true,
  imports: [
    RouterModule,
    IonList, IonItem, IonIcon, IonLabel,
    IonMenuToggle, IonButton
  ]
})
export class SidebarComponent implements OnInit, OnDestroy {
  private menuCtrl          = inject(MenuController);
  private modalCtrl         = inject(ModalController);
  private authService       = inject(AuthService);
  private turnosCajaService = inject(TurnosCajaService);
  private ui            = inject(UiService);
  private configService = inject(ConfigService);
  private router        = inject(Router);

  @Output() accionRapida = new EventEmitter<'nueva-nota' | 'cuadre' | 'calculadora'>();

  // Ruta de configuracion (usada en template)
  readonly configuracionRoute = ROUTES.configuracion.root;

  // Iconos
  userIcon = personCircleOutline;
  logoutIcon = logOutOutline;
  settingsIcon = settingsOutline;
  readerIcon = readerOutline;
  lockIcon = lockClosedOutline;

  // Nombre del negocio (header)
  nombreNegocio = '';

  // Datos del usuario (footer)
  empleadoNombre = '';
  empleadoEmail = '';
  empleadoRol: RolUsuario = 'EMPLEADO';
  esSuperadmin = false;
  private empleadoId: string | null = null;
  private negocioActivoId = '';

  // Grupos de navegación del sidebar
  private readonly todosLosGrupos: MenuGroup[] = [
    {
      label: 'Principal',
      items: [
        { title: 'Inicio', url: ROUTES.home, icon: homeOutline, exact: true },
        { title: 'POS', url: ROUTES.pos, icon: barcodeOutline, soloPos: true },
        { title: 'Inventario', url: ROUTES.inventario.root, icon: cubeOutline },
        { title: 'Ventas', url: ROUTES.ventas.root, icon: receiptOutline },
      ]
    },
    {
      label: 'Gestión',
      items: [
        { title: 'Notas', url: ROUTES.notas, icon: readerOutline },
        { title: 'Clientes', url: ROUTES.clientes.root, icon: personOutline },
        { title: 'Empleados', url: ROUTES.movimientosEmpleados.root, icon: walletOutline, soloAdmin: true },
      ]
    },
    {
      label: 'Recargas',
      items: [
        { title: 'Historial de Recargas', url: ROUTES.historialRecargas, icon: listOutline, soloRecargas: true },
        { title: 'Saldo Virtual', url: ROUTES.recargasVirtuales, icon: swapHorizontalOutline, soloRecargas: true },
      ]
    },
    {
      label: 'Admin',
      items: [
        { title: 'Usuarios', url: ROUTES.usuarios, icon: peopleOutline, soloAdmin: true }
      ]
    }
  ];

  // Grupos filtrados según el rol del usuario
  menuGroups: MenuGroup[] = [];
  private posSub!: Subscription;
  private usuarioSub!: Subscription;
  private posHabilitado = false;
  recargasCelularHabilitada = false;
  recargasBusHabilitada = false;

  constructor() {
    addIcons({ readerOutline, storefrontOutline, calculatorOutline, createOutline, scaleOutline, walletOutline, shieldCheckmarkOutline, arrowBackOutline, chevronDownOutline, lockClosedOutline });
  }

  async ngOnInit() {
    // Invalidar caché antes de leer — garantiza flags frescos desde BD cada vez
    // que el sidebar se monta, sin depender del TTL de 1 hora del caché.
    this.configService.invalidar();

    const [usuario, config] = await Promise.all([
      this.authService.getUsuarioActual(),
      this.configService.get()
    ]);

    this.recargasCelularHabilitada = config?.recargas_celular_habilitada ?? false;
    this.recargasBusHabilitada     = config?.recargas_bus_habilitada     ?? false;

    if (usuario) {
      this.aplicarDatosUsuario(usuario);
    }
    this.nombreNegocio = usuario?.negocio_nombre || '';

    // POS: solo para el empleado que abrió el turno (Realtime de turnos_caja).
    this.posSub = this.turnosCajaService.esMiTurno$.subscribe(esMio => {
      this.posHabilitado = esMio;
      this.recalcularMenu();
    });

    // Datos del usuario: actualizar sidebar cuando el admin cambia rol, nombre, etc.
    this.usuarioSub = this.authService.usuarioActual$.subscribe(usr => {
      if (usr) {
        this.aplicarDatosUsuario(usr);
        this.recalcularMenu();
      }
    });
  }

  ngOnDestroy() {
    this.posSub?.unsubscribe();
    this.usuarioSub?.unsubscribe();
  }

  private aplicarDatosUsuario(usuario: { id?: string; nombre: string; email: string; rol: RolUsuario; es_superadmin?: boolean; negocio_id?: string; negocio_nombre?: string }) {
    this.empleadoNombre = usuario.nombre;
    this.empleadoEmail = usuario.email;
    this.empleadoRol = usuario.rol;
    this.esSuperadmin = usuario.es_superadmin ?? false;
    this.empleadoId = usuario.id ?? null;
    if (usuario.negocio_id) {
      this.negocioActivoId = usuario.negocio_id;
    }
  }

  private recalcularMenu() {
    this.menuGroups = this.todosLosGrupos
      .map(group => ({
        ...group,
        items: group.items
          .filter(item =>
            (!item.soloAdmin    || this.empleadoRol === 'ADMIN') &&
            (!item.soloRecargas || this.recargasCelularHabilitada || this.recargasBusHabilitada)
          )
          .map(item => ({
            ...item,
            disabled: item.soloPos && !this.posHabilitado
          }))
      }))
      .filter(group => group.items.length > 0);
  }

  /**
   * Abre el selector de negocios (solo ADMIN, no superadmin).
   * - Seleccionar un negocio → cambiarNegocio()
   * - Elegir "Nueva sucursal" → navega a /crear-negocio?context=sucursal (wizard reutilizado del onboarding)
   */
  async abrirSelectorNegocios() {
    if (this.empleadoRol !== 'ADMIN' || this.esSuperadmin) return;
    await this.closeMenu();

    const { SelectorNegocioModalComponent } = await import('./selector-negocio-modal/selector-negocio-modal.component');

    const selector = await this.modalCtrl.create({
      component: SelectorNegocioModalComponent,
      componentProps: { negocioActivoId: this.negocioActivoId },
      cssClass: 'options-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });
    await selector.present();
    const { data, role } = await selector.onDidDismiss();

    if (role === 'seleccionar' && data) {
      await this.ui.showLoading(`Cambiando a ${data.negocio_nombre}...`);
      try {
        await this.authService.cambiarNegocio(data.negocio_id, data.negocio_nombre);
      } finally {
        await this.ui.hideLoading();
      }
      return;
    }

    if (role === 'crear') {
      this.router.navigate([ROUTES.crearNegocio.root], { queryParams: { context: 'sucursal' } });
    }
  }

  onItemDeshabilitadoClick() {
    const turno = this.turnosCajaService.turnoActivoValue;
    const msg = turno
      ? `${turno.empleado?.nombre ?? 'Otro empleado'} ya tiene el turno abierto. Solo él puede usar el POS`
      : 'Para usar el POS primero abre la caja desde Inicio';
    this.ui.showToast(msg, 'warning');
  }

  async onAccionRapida(accion: 'nueva-nota' | 'cuadre' | 'calculadora') {
    await this.closeMenu();
    this.accionRapida.emit(accion);
  }

  async closeMenu() {
    // En desktop el split pane muestra el sidebar fijo — no cerrar
    const isVisible = await this.menuCtrl.isOpen();
    if (isVisible) await this.menuCtrl.close();
  }

  async volverAlPanelAdmin() {
    await this.closeMenu();
    await this.authService.irAlPanelAdmin();
  }

  async logout() {
    await this.ui.showLoading('Verificando...');
    try {
      const turno = await this.turnosCajaService.obtenerTurnoActivo();
      await this.ui.hideLoading();
      if (turno && turno.empleado_id === this.empleadoId) {
        await this.closeMenu();
        await this.ui.showError('Tienes un turno activo. Realiza el cierre diario antes de cerrar sesión.');
        return;
      }
      await this.closeMenu();
      await this.authService.logout();
    } catch {
      await this.ui.hideLoading();
    }
  }
}
