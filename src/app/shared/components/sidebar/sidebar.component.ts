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
  receiptOutline, listOutline, swapHorizontalOutline, homeOutline
} from 'ionicons/icons';
import { AuthService } from '../../../features/auth/services/auth.service';
import { RolUsuario } from '../../../features/auth/models/usuario_actual.model';

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

  // Iconos
  userIcon = personCircleOutline;
  logoutIcon = logOutOutline;

  // Datos del usuario
  empleadoNombre = '';
  empleadoEmail = '';
  empleadoRol: RolUsuario = 'EMPLEADO';

  // Todas las rutas del sidebar
  private readonly todosLosItems: MenuItem[] = [
    { title: 'Inicio',                url: '/home',                    icon: homeOutline,             exact: true },
    { title: 'Historial de Gastos',   url: '/home/gastos-diarios',     icon: receiptOutline },
    { title: 'Historial de Recargas', url: '/home/historial-recargas', icon: listOutline },
    { title: 'Saldo Virtual',         url: '/home/recargas-virtuales', icon: swapHorizontalOutline },
    { title: 'Usuarios',              url: '/usuarios',                icon: peopleOutline,           soloAdmin: true },
    { title: 'Configuración',         url: '/configuracion',           icon: settingsOutline,         soloAdmin: true },
  ];

  // Items filtrados según el rol del usuario
  menuItems: MenuItem[] = [];

  async ngOnInit() {
    const usuario = await this.authService.getUsuarioActual();
    if (usuario) {
      this.empleadoNombre = usuario.nombre;
      this.empleadoEmail  = usuario.usuario;
      this.empleadoRol    = usuario.rol;
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
    await this.closeMenu();
    await this.authService.logout();
  }
}
