import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton, IonIcon, IonSkeletonText,
  IonFab, IonFabButton,
  IonRefresher, IonRefresherContent,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addOutline, personOutline, shieldCheckmarkOutline } from 'ionicons/icons';
import { UsuarioService } from '../../services/usuario.service';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { Usuario } from '../../models/usuario.model';
import { UiService } from '@core/services/ui.service';

@Component({
  selector: 'app-list',
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonContent,
    IonButtons, IonMenuButton, IonIcon, IonSkeletonText,
    IonFab, IonFabButton,
    IonRefresher, IonRefresherContent,
    EmptyStateComponent
  ]
})
export class ListPage implements OnInit {
  private usuarioService = inject(UsuarioService);
  private modalCtrl      = inject(ModalController);
  private ui             = inject(UiService);

  usuarios: Usuario[] = [];
  loading = false;

  constructor() {
    addIcons({ addOutline, personOutline, shieldCheckmarkOutline });
  }

  async ngOnInit() {
    this.loadUsuarios();
  }

  ionViewWillEnter() {
    this.ui.hideTabs();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  async loadUsuarios(silencioso = false) {
    if (!silencioso) this.loading = true;
    try {
      this.usuarios = await this.usuarioService.getAll();
    } catch {
      await this.ui.showError('Error al cargar los usuarios. Verificá tu conexión.');
    } finally {
      this.loading = false;
    }
  }

  async handleRefresh(event: CustomEvent) {
    await this.loadUsuarios(true);
    (event.target as HTMLIonRefresherElement).complete();
  }

  async abrirRegistrar() {
    const { RegistrarUsuarioModalComponent } = await import(
      '../../components/registrar-usuario-modal/registrar-usuario-modal.component'
    );

    const modal = await this.modalCtrl.create({
      component: RegistrarUsuarioModalComponent
    });

    modal.onDidDismiss().then(({ data, role }) => {
      if (role === 'confirm' && data) this.loadUsuarios();
    });

    await modal.present();
  }

  async abrirEditar(usuario: Usuario) {
    const { EditarUsuarioModalComponent } = await import(
      '../../components/editar-usuario-modal/editar-usuario-modal.component'
    );

    const modal = await this.modalCtrl.create({
      component: EditarUsuarioModalComponent,
      componentProps: { usuario }
    });

    modal.onDidDismiss().then(async ({ data, role }) => {
      if (role === 'confirm' && data) {
        if (data?.transferido === true) {
          const destino = data.negocioNombre ?? 'otra sucursal';
          await this.ui.showToast(`${data.empleadoNombre ?? 'El empleado'} fue transferido a ${destino}. Su membresía aquí quedó inactiva.`, 'success');
          this.loadUsuarios();
        } else {
          const idx = this.usuarios.findIndex(u => u.id === data.id);
          if (idx !== -1) {
            this.usuarios[idx] = data;
            this.usuarios = [...this.usuarios];
          }
        }
      }
    });

    await modal.present();
  }
}
