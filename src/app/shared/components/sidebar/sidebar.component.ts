import { Component, inject, OnInit, OnDestroy, Output, EventEmitter } from '@angular/core';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  IonList, IonItem, IonIcon, IonLabel,
  IonMenuToggle, IonAvatar, IonButton
} from '@ionic/angular/standalone';
import { MenuController } from '@ionic/angular/standalone';
import {
  peopleOutline, settingsOutline, logOutOutline, personCircleOutline,
  listOutline, swapHorizontalOutline, homeOutline, cubeOutline, handRightOutline,
  personOutline, readerOutline, barcodeOutline, receiptOutline,
  storefrontOutline, calculatorOutline, createOutline, scaleOutline,
  walletOutline
} from 'ionicons/icons';
import { AuthService } from '../../../features/auth/services/auth.service';
import { RolUsuario } from '../../../features/auth/models/usuario_actual.model';
import { TurnosCajaService } from '../../../features/dashboard/services/turnos-caja.service';
import { UiService } from '@core/services/ui.service';
import { ConfigService } from '@core/services/config.service';
import { addIcons } from 'ionicons';

interface MenuItem {
  title: string;
  url: string;
  icon: string;
  exact?: boolean;
  soloAdmin?: boolean;
  soloPos?: boolean;
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
    CommonModule,
    RouterModule,
    IonList, IonItem, IonIcon, IonLabel,
    IonMenuToggle, IonButton
  ]
})
export class SidebarComponent implements OnInit, OnDestroy {
  private menuCtrl = inject(MenuController);
  private authService = inject(AuthService);
  private turnosCajaService = inject(TurnosCajaService);
  private ui = inject(UiService);
  private configService = inject(ConfigService);

  @Output() accionRapida = new EventEmitter<'nueva-nota' | 'cuadre' | 'calculadora'>();

  // Iconos
  userIcon = personCircleOutline;
  logoutIcon = logOutOutline;
  settingsIcon = settingsOutline;
  readerIcon = readerOutline;

  // Nombre del negocio (header)
  nombreNegocio = '';

  // Datos del usuario (footer)
  empleadoNombre = '';
  empleadoEmail = '';
  empleadoRol: RolUsuario = 'EMPLEADO';
  private empleadoId: number | null = null;

  // Grupos de navegación del sidebar
  private readonly todosLosGrupos: MenuGroup[] = [
    {
      label: 'Principal',
      items: [
        { title: 'Inicio', url: '/home', icon: homeOutline, exact: true },
        { title: 'POS', url: '/pos', icon: barcodeOutline, soloPos: true },
        { title: 'Inventario', url: '/inventario', icon: cubeOutline },
        { title: 'Ventas', url: '/ventas', icon: receiptOutline },
      ]
    },
    {
      label: 'Gestión',
      items: [
        { title: 'Notas', url: '/notas', icon: readerOutline },
        { title: 'Cuentas por Cobrar', url: '/cuentas-cobrar', icon: handRightOutline },
        { title: 'Clientes', url: '/clientes', icon: personOutline },
      ]
    },
    {
      label: 'Recargas',
      items: [
        { title: 'Historial de Recargas', url: '/historial-recargas', icon: listOutline },
        { title: 'Saldo Virtual', url: '/home/recargas-virtuales', icon: swapHorizontalOutline },
      ]
    },
    {
      label: 'Admin',
      items: [
        { title: 'Cuentas Empleados', url: '/movimientos-empleados', icon: walletOutline, soloAdmin: true },
        { title: 'Usuarios', url: '/usuarios', icon: peopleOutline, soloAdmin: true }
      ]
    }
  ];

  // Grupos filtrados según el rol del usuario
  menuGroups: MenuGroup[] = [];
  private posSub!: Subscription;
  private usuarioSub!: Subscription;
  private posHabilitado = false;

  constructor() {
    addIcons({ readerOutline, storefrontOutline, calculatorOutline, createOutline, scaleOutline, walletOutline });
  }

  async ngOnInit() {
    const [usuario, nombreNegocio] = await Promise.all([
      this.authService.getUsuarioActual(),
      this.configService.getNombreNegocio()
    ]);

    this.nombreNegocio = nombreNegocio;

    if (usuario) {
      this.aplicarDatosUsuario(usuario);
    }

    // El estado del POS depende de si hay un turno de caja abierto.
    // TurnosCajaService emite cajaAbierta$ via Realtime de la tabla turnos_caja.
    this.posSub = this.turnosCajaService.cajaAbierta$.subscribe(abierta => {
      this.posHabilitado = abierta;
      this.recalcularMenu();
    });

    // Realtime: actualizar sidebar cuando el admin cambia rol, nombre, etc.
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

  private aplicarDatosUsuario(usuario: { id?: number; nombre: string; usuario: string; rol: RolUsuario }) {
    this.empleadoNombre = usuario.nombre;
    this.empleadoEmail = usuario.usuario;
    this.empleadoRol = usuario.rol;
    this.empleadoId = usuario.id ?? null;
  }

  private recalcularMenu() {
    this.menuGroups = this.todosLosGrupos
      .map(group => ({
        ...group,
        items: group.items.filter(item =>
          (!item.soloAdmin || this.empleadoRol === 'ADMIN') &&
          (!item.soloPos   || this.posHabilitado)
        )
      }))
      .filter(group => group.items.length > 0);
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

  async logout() {
    const turno = await this.turnosCajaService.obtenerTurnoActivo();
    if (turno && turno.empleado_id === this.empleadoId) {
      await this.closeMenu();
      await this.ui.showError('Tienes un turno activo. Realizá el cierre diario antes de cerrar sesión.');
      return;
    }

    await this.closeMenu();
    await this.authService.logout();
  }
}
