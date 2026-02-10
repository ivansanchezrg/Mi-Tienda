import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  IonList, IonItem, IonIcon, IonLabel,
  IonMenuToggle, IonAvatar, IonButton
} from '@ionic/angular/standalone';
import { MenuController } from '@ionic/angular/standalone';
import {
  peopleOutline, settingsOutline, logOutOutline, personCircleOutline, receiptOutline, listOutline
} from 'ionicons/icons';
import { AuthService } from '../../../features/auth/services/auth.service';

interface MenuItem {
  title: string;
  url: string;
  icon: string;
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
  empleadoRol = 'Empleado';

  // Rutas específicas del sidebar (NO están en los tabs)
  menuItems: MenuItem[] = [
    { title: 'Gastos Diarios', url: '/home/gastos-diarios', icon: receiptOutline },
    { title: 'Recargas', url: '/home/historial-recargas', icon: listOutline },
    { title: 'Empleados', url: '/employees', icon: peopleOutline },
    { title: 'Configuración', url: '/configuracion', icon: settingsOutline },
  ];

  async ngOnInit() {
    const user = await this.authService.getUser();
    if (user) {
      this.empleadoNombre = user.user_metadata?.['full_name'] || user.user_metadata?.['name'] || 'Usuario';
      this.empleadoEmail = user.email || '';
    }
  }

  async closeMenu() {
    await this.menuCtrl.close();
  }

  async logout() {
    await this.closeMenu();
    await this.authService.logout();
  }
}
