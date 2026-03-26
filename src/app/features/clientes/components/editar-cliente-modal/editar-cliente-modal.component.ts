import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon,
    IonContent, IonSpinner,
    ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    closeOutline, checkmarkCircleOutline, alertCircleOutline
} from 'ionicons/icons';
import { ClientesService } from '../../services/clientes.service';
import { Cliente } from '../../models/cliente.model';
import { UiService } from '../../../../core/services/ui.service';
import { validarCedulaEcuatoriana } from '../../../../core/utils/cedula.util';

@Component({
    selector: 'app-editar-cliente-modal',
    templateUrl: './editar-cliente-modal.component.html',
    styleUrls: ['./editar-cliente-modal.component.scss'],
    standalone: true,
    imports: [
        CommonModule, FormsModule,
        IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon,
        IonContent, IonSpinner
    ]
})
export class EditarClienteModalComponent {
    /** Si se pasa, es modo edición. Si no, es modo creación. */
    @Input() cliente: Cliente | null = null;

    private modalCtrl = inject(ModalController);
    private clientesService = inject(ClientesService);
    private ui = inject(UiService);

    get esCreacion(): boolean { return !this.cliente; }

    // Campos del formulario
    identificacion = '';
    nombre = '';
    telefono = '';
    email = '';
    guardando = false;

    // Estado de validación de cédula (solo modo creación)
    cedulaEstado: 'idle' | 'valida' | 'invalida' | 'buscando' = 'idle';
    clienteDuplicado: Cliente | null = null;

    constructor() {
        addIcons({ closeOutline, checkmarkCircleOutline, alertCircleOutline });
    }

    ngOnInit() {
        if (this.cliente) {
            this.identificacion = this.cliente.identificacion ?? '';
            this.nombre = this.cliente.nombre;
            this.telefono = this.cliente.telefono ?? '';
            this.email = this.cliente.email ?? '';
        }
    }

    get hayCambios(): boolean {
        if (this.esCreacion) {
            return this.nombre.trim().length > 0;
        }
        return this.nombre.trim() !== this.cliente!.nombre
            || (this.telefono.trim() || '') !== (this.cliente!.telefono || '')
            || (this.email.trim() || '') !== (this.cliente!.email || '');
    }

    get camposHabilitados(): boolean {
        if (!this.esCreacion) return true;
        return this.cedulaEstado === 'valida' && !this.clienteDuplicado;
    }

    // ── Validación cédula (solo creación) ──────────────────────

    async onIdentificacionInput() {
        const cedula = this.identificacion.trim();
        this.clienteDuplicado = null;
        this.cedulaEstado = 'idle';

        if (cedula.length < 10) return;

        if (!validarCedulaEcuatoriana(cedula)) {
            this.cedulaEstado = 'invalida';
            return;
        }

        this.cedulaEstado = 'buscando';
        try {
            const existente = await this.clientesService.buscarPorIdentificacion(cedula);
            if (existente) {
                this.clienteDuplicado = existente;
            }
            this.cedulaEstado = 'valida';
        } catch {
            this.cedulaEstado = 'invalida';
        }
    }

    seleccionarDuplicado() {
        if (!this.clienteDuplicado) return;
        // Cambiar a modo edición con el cliente existente
        this.cliente = this.clienteDuplicado;
        this.identificacion = this.clienteDuplicado.identificacion ?? '';
        this.nombre = this.clienteDuplicado.nombre;
        this.telefono = this.clienteDuplicado.telefono ?? '';
        this.email = this.clienteDuplicado.email ?? '';
        this.clienteDuplicado = null;
        this.cedulaEstado = 'idle';
    }

    // ── Guardar ────────────────────────────────────────────────

    async guardar() {
        if (!this.nombre.trim()) {
            this.ui.showToast('El nombre es obligatorio', 'warning');
            return;
        }
        if (this.guardando || !this.hayCambios) return;

        this.guardando = true;
        try {
            if (this.esCreacion) {
                const nuevo = await this.clientesService.crearCliente({
                    nombre: this.nombre.trim().toUpperCase(),
                    identificacion: this.identificacion.trim() || undefined,
                    telefono: this.telefono.trim() || undefined,
                    email: this.email.trim() || undefined,
                });
                if (nuevo) {
                    this.modalCtrl.dismiss({ cliente: nuevo });
                }
            } else {
                const actualizado = await this.clientesService.actualizarCliente(this.cliente!.id, {
                    nombre: this.nombre.trim().toUpperCase(),
                    telefono: this.telefono.trim() || undefined,
                    email: this.email.trim() || undefined,
                });
                if (actualizado) {
                    this.modalCtrl.dismiss({ cliente: actualizado });
                }
            }
        } finally {
            this.guardando = false;
        }
    }

    cerrar() {
        this.modalCtrl.dismiss();
    }
}
