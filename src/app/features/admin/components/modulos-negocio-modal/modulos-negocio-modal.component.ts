import { Component, inject, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonIcon, IonButton, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { phonePortraitOutline, busOutline, walletOutline, archiveOutline, closeOutline } from 'ionicons/icons';
import { SupabaseService } from '@core/services/supabase.service';
import { UiService } from '@core/services/ui.service';
import { NegocioAdmin } from '../../models/negocio-admin.model';

@Component({
  selector: 'app-modulos-negocio-modal',
  templateUrl: './modulos-negocio-modal.component.html',
  styleUrls: ['./modulos-negocio-modal.component.scss'],
  standalone: true,
  imports: [IonIcon, IonButton, FormsModule]
})
export class ModulosNegocioModalComponent implements OnInit {
  @Input() negocio!: NegocioAdmin;

  private modalCtrl = inject(ModalController);
  private supabase  = inject(SupabaseService);
  private ui        = inject(UiService);

  celular      = false;
  bus          = false;
  varios       = false;
  variosMonto  = 0;
  guardando    = false;

  get variosMontoInvalido(): boolean {
    return this.varios && this.variosMonto <= 0;
  }

  constructor() {
    addIcons({ phonePortraitOutline, busOutline, walletOutline, archiveOutline, closeOutline });
  }

  ngOnInit() {
    this.celular     = this.negocio.modulos.celular;
    this.bus         = this.negocio.modulos.bus;
    this.varios      = this.negocio.modulos.varios;
    this.variosMonto = this.negocio.modulos.varios_monto ?? 0;
  }

  cerrar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async guardar() {
    if (this.guardando) return;
    if (this.variosMontoInvalido) return;
    this.guardando = true;
    try {
      await this.supabase.call(
        this.supabase.client.rpc('fn_configurar_modulos_admin', {
          p_negocio_id:   this.negocio.id,
          p_celular:      this.celular,
          p_bus:          this.bus,
          p_varios:       this.varios,
          p_varios_monto: this.varios ? this.variosMonto : 0
        }),
        'Módulos actualizados'
      );
      this.modalCtrl.dismiss(
        { celular: this.celular, bus: this.bus, varios: this.varios, varios_monto: this.variosMonto },
        'confirm'
      );
    } finally {
      this.guardando = false;
    }
  }
}
