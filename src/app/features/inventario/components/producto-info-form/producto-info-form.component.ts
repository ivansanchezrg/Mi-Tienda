import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { SafeUrl } from '@angular/platform-browser';
import {
    ModalController, IonItem, IonInput, IonIcon, IonButton
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    barcodeOutline, cameraOutline, closeCircle, ellipsisHorizontal,
    chevronDownOutline, checkmarkCircleOutline, sparklesOutline,
    cubeOutline, scaleOutline, cropOutline, trashOutline
} from 'ionicons/icons';
import { StorageService } from '../../../../core/services/storage.service';
import { BarcodeScannerService, getBarcodeInputHint } from '../../../../core/services/barcode-scanner.service';
import { UiService } from '../../../../core/services/ui.service';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';
import { CategoriaProducto } from '../../models/categoria-producto.model';
import { ScannerOverlayComponent } from '../../../../shared/components/scanner-overlay/scanner-overlay.component';

export interface FotoSeleccionada {
    previewUrl: SafeUrl;
    rawUrl: string;
}

@Component({
    selector: 'app-producto-info-form',
    templateUrl: './producto-info-form.component.html',
    styleUrls: ['./producto-info-form.component.scss'],
    standalone: true,
    imports: [
        CommonModule, ReactiveFormsModule,
        IonItem, IonInput, IonIcon, IonButton,
        ScannerOverlayComponent,
    ]
})
export class ProductoInfoFormComponent {
    /** FormGroup con: nombre, categoria_id, codigo_barras, tipo_venta, unidad_medida */
    @Input({ required: true }) formGroup!: FormGroup;
    @Input() categorias: CategoriaProducto[] = [];
    @Input() modo: 'crear' | 'editar' = 'crear';
    /** true cuando es SKU de variante — oculta tipo_venta (lo hereda del template) */
    @Input() esVariante = false;
    /** true cuando el flujo eligió "tamaños o empaques" — fuerza UNIDAD y oculta el selector */
    @Input() ocultarTipoVenta = false;
    /** URL ya resuelta de imagen existente (modo editar) */
    @Input() imagenUrlExistente: string | null = null;
    /** SafeUrl de preview local (recién capturada) */
    @Input() fotoPreviewUrl: SafeUrl | null = null;
    /** rawUrl (base64) de la foto local — necesario para re-cropear sin recapturar */
    @Input() fotoRawUrl: string | null = null;

    @Output() fotoSeleccionada = new EventEmitter<FotoSeleccionada>();
    @Output() fotoRemovida     = new EventEmitter<void>();
    @Output() codigoEscaneado  = new EventEmitter<string>();
    @Output() tipoVentaCambiado = new EventEmitter<'UNIDAD' | 'PESO'>();

    escaneando = false;
    readonly barcodeHint = getBarcodeInputHint();

    protected storageService  = inject(StorageService);
    protected barcodeScanner  = inject(BarcodeScannerService);
    private modalCtrl         = inject(ModalController);
    private ui                = inject(UiService);

    constructor() {
        addIcons({
            barcodeOutline, cameraOutline, closeCircle, ellipsisHorizontal,
            chevronDownOutline, checkmarkCircleOutline, sparklesOutline,
            cubeOutline, scaleOutline, cropOutline, trashOutline
        });
    }

    get categoriaLabel(): string {
        const id = this.formGroup.get('categoria_id')?.value;
        if (!id) return 'Seleccionar categoria *';
        return this.categorias.find(c => c.id === id)?.nombre || 'Seleccionar categoria *';
    }

    esCampoInvalido(campo: string): boolean {
        const ctrl = this.formGroup.get(campo);
        return !!(ctrl && ctrl.invalid && (ctrl.dirty || ctrl.touched));
    }

    async abrirSelectorCategoria() {
        const groups: ModalOptionGroup[] = [{
            title: 'Categorias',
            options: this.categorias.map(cat => ({ label: cat.nombre, value: String(cat.id) }))
        }];
        const currentId = this.formGroup.get('categoria_id')?.value;
        const modal = await this.modalCtrl.create({
            component: OptionsModalComponent,
            componentProps: {
                title: 'Categoria del producto',
                groups,
                selectedValue: currentId ? String(currentId) : undefined
            },
            cssClass: 'options-modal',
            breakpoints: [0, 1],
            initialBreakpoint: 1
        });
        await modal.present();
        const { data } = await modal.onDidDismiss();
        this.formGroup.get('categoria_id')?.markAsTouched();
        if (data) {
            this.formGroup.get('categoria_id')?.setValue(data);
            this.formGroup.get('categoria_id')?.markAsDirty();
        }
    }

    async escanearCodigo() {
        this.escaneando = true;
        const codigo = await this.barcodeScanner.scan();
        this.escaneando = false;
        if (!codigo) return;
        this.formGroup.patchValue({ codigo_barras: codigo });
        this.codigoEscaneado.emit(codigo);
        this.ui.showToast(`Codigo capturado: ${codigo}`, 'success');
    }

    async cerrarEscaner() {
        await this.barcodeScanner.stop();
        this.escaneando = false;
    }

    /** Bloquea aperturas concurrentes del flujo de imagen (doble-tap, etc.) */
    private procesandoImagen = false;

    async seleccionarFoto() {
        if (this.procesandoImagen) return;
        this.procesandoImagen = true;
        try {
            const result = await this.storageService.elegirFuenteFoto();
            if (!result) return;
            this.fotoSeleccionada.emit({ previewUrl: result.previewUrl, rawUrl: result.rawUrl });
        } finally {
            this.procesandoImagen = false;
        }
    }

    removerFoto() {
        this.fotoRemovida.emit();
    }

    /**
     * Abre el menú de opciones cuando ya hay una imagen seleccionada/cargada.
     * - 'recortar' → vuelve a abrir el cropper sobre la imagen actual (sin retomar la foto)
     * - 'cambiar'  → flujo completo: elegir fuente → recortar
     * - 'quitar'   → emite fotoRemovida
     */
    async abrirOpcionesImagen() {
        if (this.procesandoImagen) return;
        this.procesandoImagen = true;
        try {
            const accion = await this.storageService.mostrarOpcionesImagen();
            if (!accion) return;

            if (accion === 'quitar') {
                this.removerFoto();
                return;
            }

            if (accion === 'cambiar') {
                // Liberar el lock antes de llamar a seleccionarFoto (que lo vuelve a tomar)
                this.procesandoImagen = false;
                await this.seleccionarFoto();
                return;
            }

            // 'recortar' — necesitamos la URL real de la imagen actual
            const url = this.fotoRawUrl ?? this.imagenUrlExistente;
            if (!url) {
                this.procesandoImagen = false;
                await this.seleccionarFoto();
                return;
            }

            const result = await this.storageService.recortarImagen(url);
            if (!result) return;
            this.fotoSeleccionada.emit({ previewUrl: result.previewUrl, rawUrl: result.rawUrl });
        } finally {
            this.procesandoImagen = false;
        }
    }

    onTipoVentaChange(tipo: 'UNIDAD' | 'PESO') {
        this.formGroup.patchValue({
            tipo_venta: tipo,
            unidad_medida: tipo === 'PESO' ? 'lb' : 'und'
        });
        this.tipoVentaCambiado.emit(tipo);
    }
}
