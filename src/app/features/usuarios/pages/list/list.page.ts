import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonContent,
  IonButtons, IonMenuButton, IonIcon, IonSpinner,
  IonFab, IonFabButton,
  IonRefresher, IonRefresherContent,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addOutline, personOutline } from 'ionicons/icons';
import { UsuarioService } from '../../services/usuario.service';
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
    IonButtons, IonMenuButton, IonIcon, IonSpinner,
    IonFab, IonFabButton,
    IonRefresher, IonRefresherContent
  ]
})
export class ListPage implements OnInit {
  private usuarioService = inject(UsuarioService);
  private modalCtrl = inject(ModalController);
  private ui = inject(UiService);

  usuarios: Usuario[] = [];
  loading = false;

  constructor() {
    addIcons({ addOutline, personOutline });
  }

  ngOnInit() {
    this.loadUsuarios();
  }

  ionViewWillEnter() {
    this.ui.hideTabs();
  }

  ionViewWillLeave() {
    this.ui.showTabs();
  }

  async loadUsuarios() {
    this.loading = true;
    try {
      this.usuarios = await this.usuarioService.getAll();
    } finally {
      this.loading = false;
    }
  }

  async handleRefresh(event: any) {
    await this.loadUsuarios();
    event.target.complete();
  }

  /**
   * Abre el modal para registrar un nuevo usuario
   */
  async abrirRegistrar() {
    const { RegistrarUsuarioModalComponent } = await import(
      '../../components/registrar-usuario-modal/registrar-usuario-modal.component'
    );

    const modal = await this.modalCtrl.create({
      component: RegistrarUsuarioModalComponent,
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });

    modal.onDidDismiss().then(({ data, role }) => {
      if (role === 'confirm' && data) {
        this.loadUsuarios();
      }
    });

    await modal.present();
  }

  /**
   * Abre el modal para editar un usuario existente
   */
  async abrirEditar(usuario: Usuario) {
    const { EditarUsuarioModalComponent } = await import(
      '../../components/editar-usuario-modal/editar-usuario-modal.component'
    );

    const modal = await this.modalCtrl.create({
      component: EditarUsuarioModalComponent,
      componentProps: { usuario },
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });

    modal.onDidDismiss().then(({ data, role }) => {
      if (role === 'confirm' && data) {
        const idx = this.usuarios.findIndex(u => u.id === data.id);
        if (idx !== -1) {
          this.usuarios[idx] = data;
          this.usuarios = [...this.usuarios];
        }
      }
    });

    await modal.present();
  }
}
