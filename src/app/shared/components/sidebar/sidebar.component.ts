import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  IonList, IonItem, IonIcon, IonLabel,
  IonMenuToggle, IonAvatar, IonButton
} from '@ionic/angular/standalone';
import { MenuController } from '@ionic/angular/standalone';
import {
  peopleOutline, settingsOutline, logOutOutline, personCircleOutline,
  listOutline, swapHorizontalOutline, homeOutline, cubeOutline, receiptOutline
} from 'ionicons/icons';
import { AuthService } from '../../../features/auth/services/auth.service';
import { RolUsuario } from '../../../features/auth/models/usuario_actual.model';
import { TurnosCajaService } from '../../../features/dashboard/services/turnos-caja.service';
import { UiService } from '@core/services/ui.service';

interface MenuItem {
  title: string;
  url: string;
  icon: string;
  exact?: boolean;
  soloAdmin?: boolean;
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
    IonMenuToggle, IonAvatar, IonButton
  ]
})
export class SidebarComponent implements OnInit {
  private menuCtrl = inject(MenuController);
  private authService = inject(AuthService);
  private turnosCajaService = inject(TurnosCajaService);
  private ui = inject(UiService);

  // Iconos
  userIcon = personCircleOutline;
  logoutIcon = logOutOutline;
  settingsIcon = settingsOutline;

  // Datos del usuario
  empleadoNombre = '';
  empleadoEmail = '';
  empleadoRol: RolUsuario = 'EMPLEADO';
  private empleadoId: number | null = null;

  // Todas las rutas del sidebar
  private readonly todosLosItems: MenuItem[] = [
    { title: 'Inicio', url: '/home', icon: homeOutline, exact: true },
    { title: 'Ventas', url: '/ventas', icon: receiptOutline },
    { title: 'Historial de Recargas', url: '/historial-recargas', icon: listOutline },
    { title: 'Saldo Virtual', url: '/home/recargas-virtuales', icon: swapHorizontalOutline },
    { title: 'Usuarios', url: '/usuarios', icon: peopleOutline, soloAdmin: true }
  ];

  // Items filtrados según el rol del usuario
  menuItems: MenuItem[] = [];

  async ngOnInit() {
    const usuario = await this.authService.getUsuarioActual();
    if (usuario) {
      this.empleadoNombre = usuario.nombre;
      this.empleadoEmail = usuario.usuario;
      this.empleadoRol = usuario.rol;
      this.empleadoId = usuario.id ?? null;
    }

    // Filtrar items: ADMIN ve todo, EMPLEADO solo ve los no-admin
    this.menuItems = this.todosLosItems.filter(item =>
      !item.soloAdmin || this.empleadoRol === 'ADMIN'
    );
  }

  async closeMenu() {
    await this.menuCtrl.close();
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
