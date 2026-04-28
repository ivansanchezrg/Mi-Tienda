import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalController } from '@ionic/angular/standalone';
import { IonIcon, IonButton, IonSpinner } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { storefrontOutline, closeOutline } from 'ionicons/icons';
import { NegocioService } from '../../../../features/auth/services/negocio.service';
import { UiService } from '@core/services/ui.service';

@Component({
  selector: 'app-crear-sucursal-modal',
  templateUrl: './crear-sucursal-modal.component.html',
  styleUrls: ['./crear-sucursal-modal.component.scss'],
  standalone: true,
  imports: [FormsModule, IonIcon, IonButton, IonSpinner]
})
export class CrearSucursalModalComponent {
  private modalCtrl     = inject(ModalController);
  private negocioService = inject(NegocioService);
  private ui            = inject(UiService);

  nombre = '';
  guardando = false;
  touched = false;

  constructor() {
    addIcons({ storefrontOutline, closeOutline });
  }

  get nombreInvalido(): boolean {
    return this.touched && this.nombre.trim().length === 0;
  }

  async confirmar() {
    this.touched = true;
    if (this.nombre.trim().length === 0) return;
    if (this.guardando) return;

    this.guardando = true;
    try {
      const resultado = await this.negocioService.crearSucursal(this.nombre);
      if (!resultado) {
        await this.ui.showError('No se pudo crear la sucursal. Intentá de nuevo.');
        return;
      }
      this.modalCtrl.dismiss(resultado, 'confirm');
    } finally {
      this.guardando = false;
    }
  }

  cerrar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
