import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon,
    IonContent, IonList, IonItem, IonLabel, IonSearchbar, IonSpinner,
    ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    closeOutline, personOutline, addOutline, checkmarkOutline,
    informationCircleOutline, personAddOutline
} from 'ionicons/icons';
import { ClientesService } from '../../services/clientes.service';
import { Cliente } from '../../models/cliente.model';
import { TipoComprobante } from '../../../pos/models/tipo-comprobante.enum';
import { UiService } from '../../../../core/services/ui.service';

@Component({
    selector: 'app-seleccionar-cliente-modal',
    templateUrl: './seleccionar-cliente-modal.component.html',
    styleUrls: ['./seleccionar-cliente-modal.component.scss'],
    standalone: true,
    imports: [
        CommonModule, FormsModule,
        IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon,
        IonContent, IonList, IonItem, IonLabel, IonSearchbar, IonSpinner
    ]
})
export class SeleccionarClienteModalComponent implements OnInit {
    @Input() tipoComprobante: TipoComprobante = TipoComprobante.TICKET;
    @Input() clienteActual: Cliente | null = null;

    readonly TipoComprobante = TipoComprobante;

    private modalCtrl = inject(ModalController);
    private clientesService = inject(ClientesService);
    private ui = inject(UiService);

    consumidorFinal: Cliente | null = null;
    clientes: Cliente[] = [];
    buscando = false;
    textoBusqueda = '';

    // Formulario nuevo cliente
    mostrarFormNuevo = false;
    nuevoNombre = '';
    nuevoIdentificacion = '';
    nuevoTelefono = '';
    guardando = false;

    constructor() {
        addIcons({ closeOutline, personOutline, addOutline, checkmarkOutline, informationCircleOutline, personAddOutline });
    }

    async ngOnInit() {
        this.consumidorFinal = await this.clientesService.obtenerConsumidorFinal();
    }

    async buscar(event: any) {
        const texto = event.detail.value?.trim();
        this.textoBusqueda = texto;

        if (!texto) {
            this.clientes = [];
            return;
        }

        this.buscando = true;
        try {
            this.clientes = await this.clientesService.buscarClientes(texto);
        } finally {
            this.buscando = false;
        }
    }

    seleccionar(cliente: Cliente) {
        if (this.tipoComprobante === TipoComprobante.FACTURA && cliente.es_consumidor_final) {
            this.ui.showToast('La Factura requiere un cliente con RUC o cédula', 'warning');
            return;
        }
        this.modalCtrl.dismiss({ cliente });
    }

    async guardarNuevo() {
        if (!this.nuevoNombre.trim()) {
            this.ui.showToast('El nombre es obligatorio', 'warning');
            return;
        }
        if (this.tipoComprobante === TipoComprobante.FACTURA && !this.nuevoIdentificacion.trim()) {
            this.ui.showToast('La Factura requiere RUC o cédula', 'warning');
            return;
        }

        this.guardando = true;
        try {
            const cliente = await this.clientesService.crearCliente({
                nombre: this.nuevoNombre.trim().toUpperCase(),
                identificacion: this.nuevoIdentificacion.trim() || undefined,
                telefono: this.nuevoTelefono.trim() || undefined,
            });
            if (cliente) {
                this.modalCtrl.dismiss({ cliente });
            }
        } finally {
            this.guardando = false;
        }
    }

    cerrar() {
        this.modalCtrl.dismiss();
    }
}
