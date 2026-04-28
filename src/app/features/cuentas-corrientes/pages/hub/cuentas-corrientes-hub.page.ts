import { Component, inject } from '@angular/core';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonIcon, IonButtons, IonMenuButton,
  NavController, ViewWillEnter, ViewWillLeave
} from '@ionic/angular/standalone';
import { UiService } from '../../../../core/services/ui.service';
import { addIcons } from 'ionicons';
import {
  receiptOutline, walletOutline, storefrontOutline,
} from 'ionicons/icons';
import { ROUTES } from '../../../../core/config/routes.config';

interface ItemMenu {
  titulo:    string;
  subtitulo: string;
  icon:      string;
  color:     string;
  ruta:      string | null;
}

@Component({
  selector: 'app-cuentas-corrientes-hub',
  templateUrl: './cuentas-corrientes-hub.page.html',
  styleUrls: ['./cuentas-corrientes-hub.page.scss'],
  standalone: true,
  imports: [
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonIcon, IonButtons, IonMenuButton,
  ]
})
export class CuentasCorrientesHubPage implements ViewWillEnter, ViewWillLeave {

  private navCtrl = inject(NavController);
  private ui      = inject(UiService);

  readonly items: ItemMenu[] = [
    {
      titulo:    'Créditos',
      subtitulo: 'Gestiona ventas fiadas y cobros pendientes',
      icon:      'receipt-outline',
      color:     'warning',
      ruta:      ROUTES.cuentasCobrar.root,
    },
    {
      titulo:    'Empleados',
      subtitulo: 'Adelantos, ajustes y pago de nómina',
      icon:      'wallet-outline',
      color:     'primary',
      ruta:      ROUTES.movimientosEmpleados.root,
    },
    {
      titulo:    'Proveedores',
      subtitulo: 'Compras a crédito pendientes de pago',
      icon:      'storefront-outline',
      color:     'medium',
      ruta:      null,
    },
  ];

  constructor() {
    addIcons({ receiptOutline, walletOutline, storefrontOutline });
  }

  ionViewWillEnter() { this.ui.hideTabs(); }
  ionViewWillLeave() { this.ui.showTabs(); }

  navegar(ruta: string | null) {
    if (!ruta) return;
    this.navCtrl.navigateForward(ruta);
  }
}
