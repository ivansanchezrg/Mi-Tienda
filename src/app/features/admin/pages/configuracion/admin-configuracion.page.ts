import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton, IonIcon,
  IonSkeletonText, IonFooter, ModalController, AlertController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  shieldCheckmarkOutline, logoWhatsapp, addOutline, createOutline,
  trashOutline, saveOutline,
} from 'ionicons/icons';
import { AdminTabsComponent } from '../../components/admin-tabs/admin-tabs.component';
import { CuentaBancariaModalComponent } from '../../components/cuenta-bancaria-modal/cuenta-bancaria-modal.component';
import { AuthService } from '../../../auth/services/auth.service';
import { SuscripcionService } from '@core/services/suscripcion.service';
import { ConfigPlataforma, CuentaBancaria } from '../../../suscripcion/models/suscripcion.model';

/** Tab "Cobro" del panel admin: edita config_plataforma (WhatsApp + cuentas bancarias). */
@Component({
  selector: 'app-admin-configuracion',
  templateUrl: './admin-configuracion.page.html',
  styleUrls: ['./admin-configuracion.page.scss'],
  standalone: true,
  imports: [
    FormsModule, CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonButton, IonIcon,
    IonSkeletonText, IonFooter, AdminTabsComponent,
  ],
})
export class AdminConfiguracionPage implements OnInit {
  private auth = inject(AuthService);
  private suscripcion = inject(SuscripcionService);
  private modalCtrl = inject(ModalController);
  private alertCtrl = inject(AlertController);

  loading = false;
  guardando = false;

  whatsapp = '';
  cuentas: CuentaBancaria[] = [];

  constructor() {
    addIcons({
      shieldCheckmarkOutline, logoWhatsapp, addOutline, createOutline,
      trashOutline, saveOutline,
    });
  }

  async ngOnInit() {
    await this.cargar();
  }

  async cargar() {
    this.loading = true;
    try {
      const config = await this.suscripcion.getConfigPlataformaAdmin();
      this.whatsapp = config?.whatsapp_cobro ?? '';
      this.cuentas = config?.cuentas_bancarias ? [...config.cuentas_bancarias] : [];
    } finally {
      this.loading = false;
    }
  }

  async agregarCuenta() {
    await this.abrirCuentaModal(null, -1);
  }

  async editarCuenta(cuenta: CuentaBancaria, index: number) {
    await this.abrirCuentaModal(cuenta, index);
  }

  private async abrirCuentaModal(cuenta: CuentaBancaria | null, index: number) {
    const modal = await this.modalCtrl.create({
      component: CuentaBancariaModalComponent,
      componentProps: { cuenta },
      cssClass: 'bottom-sheet-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();
    const { data, role } = await modal.onDidDismiss<CuentaBancaria>();
    if (role === 'confirm' && data) {
      if (index >= 0) this.cuentas[index] = data;
      else this.cuentas = [...this.cuentas, data];
    }
  }

  async eliminarCuenta(index: number) {
    const ok = await this.confirmar('Eliminar cuenta', '¿Eliminar esta cuenta bancaria?');
    if (!ok) return;
    this.cuentas = this.cuentas.filter((_, i) => i !== index);
  }

  async guardar() {
    if (this.guardando) return;
    this.guardando = true;
    try {
      const config: ConfigPlataforma = {
        whatsapp_cobro: this.whatsapp.trim() || null,
        cuentas_bancarias: this.cuentas,
      };
      await this.suscripcion.guardarConfigPlataforma(config);
    } finally {
      this.guardando = false;
    }
  }

  private async confirmar(header: string, message: string): Promise<boolean> {
    const alert = await this.alertCtrl.create({
      header,
      message,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Confirmar', role: 'confirm' },
      ],
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }

  async salir() {
    await this.auth.logout();
  }
}
