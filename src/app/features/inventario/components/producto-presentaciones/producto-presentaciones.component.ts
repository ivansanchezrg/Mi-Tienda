import { Component, Input, Output, EventEmitter, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    addOutline, trashOutline, closeOutline, refreshOutline, createOutline,
    chevronDownOutline, chevronUpOutline, informationCircleOutline, imageOutline
} from 'ionicons/icons';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { AlertController } from '@ionic/angular/standalone';
import { StorageService } from '../../../../core/services/storage.service';
import { PresentacionService } from '../../services/presentacion.service';
import { ProductoPresentacion } from '../../models/producto.model';
import { PresentacionModalComponent, PresentacionModalResult } from '../presentacion-modal/presentacion-modal.component';

export interface PresentacionNueva {
    nombre: string;
    factor_conversion: number;
    precio_venta: number;
    precio_costo: number;
    codigo_barras?: string;
    /** path en BD o `__pending__<rawUrl>` para las que aún no se han subido */
    imagen_url?: string | null;
    /** URL local para thumbnail en lista (modo crear) */
    previewUrl?: string;
}

@Component({
    selector: 'app-producto-presentaciones',
    templateUrl: './producto-presentaciones.component.html',
    styleUrls: ['./producto-presentaciones.component.scss'],
    standalone: true,
    imports: [
        CommonModule,
        IonIcon,
    ]
})
export class ProductoPresentacionesComponent implements OnInit {
    /** ID del producto ya creado (modo editar). Si es null, opera en memoria (modo crear). */
    @Input() productoId: string | null = null;
    /** Nombre del producto — se pasa al modal para contexto */
    @Input() nombreProducto = '';
    /** Costo del producto base — se pasa al modal para calcular margen */
    @Input() precioCosto = 0;
    /** Subcarpeta de storage para imágenes (ej: 'productos/bebidas') */
    @Input() storageSubfolder = 'productos/sin-categoria';
    /** Modo de operación */
    @Input() modo: 'crear' | 'editar' = 'crear';

    /** Presentaciones en memoria (modo crear). El padre las lee al guardar. */
    @Input()  presentacionesNuevas: PresentacionNueva[] = [];
    @Output() presentacionesNuevasChange = new EventEmitter<PresentacionNueva[]>();

    /** Notifica que una presentación persisted fue creada/actualizada/desactivada */
    @Output() cambioPersistido = new EventEmitter<void>();

    protected currencyService  = inject(CurrencyService);
    private modalCtrl          = inject(ModalController);
    private alertCtrl          = inject(AlertController);
    private ui                 = inject(UiService);
    private storageService     = inject(StorageService);
    private presentacionSvc    = inject(PresentacionService);

    // Estado modo editar
    presentaciones: ProductoPresentacion[] = [];
    presentacionesInactivas: ProductoPresentacion[] = [];
    presentacionesImagenUrls = new Map<string, string>();
    mostrarInactivas = false;
    presentacionRecienAgregada: string | null = null;

    constructor() {
        addIcons({
            addOutline, trashOutline, closeOutline, refreshOutline, createOutline,
            chevronDownOutline, chevronUpOutline, informationCircleOutline, imageOutline
        });
    }

    async ngOnInit() {
        if (this.modo === 'editar' && this.productoId) {
            await this.cargarPresentaciones();
        }
    }

    private async cargarPresentaciones() {
        if (!this.productoId) return;
        [this.presentaciones, this.presentacionesInactivas] = await Promise.all([
            this.presentacionSvc.obtenerPresentaciones(this.productoId),
            this.presentacionSvc.obtenerPresentacionesInactivas(this.productoId),
        ]);
        await this._resolverImagenes([...this.presentaciones, ...this.presentacionesInactivas]);
    }

    private async _resolverImagenes(lista: ProductoPresentacion[]) {
        await Promise.all(
            lista.filter(p => p.imagen_url).map(async p => {
                const url = await this.storageService.resolveImageUrl(p.imagen_url);
                if (url) this.presentacionesImagenUrls.set(p.id, url);
            })
        );
    }

    private animarPresentacion(nombre: string) {
        this.presentacionRecienAgregada = nombre;
        setTimeout(() => { this.presentacionRecienAgregada = null; }, 400);
    }

    // ── MODO CREAR (en memoria) ───────────────────────────────────────────────

    async agregarNueva() {
        if (!this.nombreProducto.trim()) {
            this.ui.showToast('Ingresa el nombre del producto antes de agregar presentaciones', 'warning');
            return;
        }
        const result = await this._abrirModal();
        if (!result) return;

        const pres: PresentacionNueva = {
            nombre: result.nombre,
            factor_conversion: result.factor_conversion,
            precio_venta: result.precio_venta,
            precio_costo: result.precio_costo,
            codigo_barras: result.codigo_barras,
            imagen_url: result.imagenRawUrl ? `__pending__${result.imagenRawUrl}` : result.imagen_url,
            previewUrl: result.imagenRawUrl || undefined
        };
        this.presentacionesNuevas = [...this.presentacionesNuevas, pres];
        this.presentacionesNuevasChange.emit(this.presentacionesNuevas);
        this.animarPresentacion(result.nombre);
    }

    async editarNueva(index: number) {
        const pres = this.presentacionesNuevas[index];
        const nombresOtros = this.presentacionesNuevas.filter((_, i) => i !== index).map(p => p.nombre);
        const imagenExistente = pres.imagen_url?.startsWith('__pending__') ? null : pres.imagen_url ?? null;

        const result = await this._abrirModal(pres, undefined, imagenExistente);
        if (!result) return;

        const updated: PresentacionNueva = {
            nombre: result.nombre,
            factor_conversion: result.factor_conversion,
            precio_venta: result.precio_venta,
            precio_costo: result.precio_costo,
            codigo_barras: result.codigo_barras,
            imagen_url: result.imagenRawUrl
                ? `__pending__${result.imagenRawUrl}`
                : result.imagen_url !== undefined ? result.imagen_url : pres.imagen_url,
            previewUrl: result.imagenRawUrl
                ? result.imagenRawUrl
                : result.imagen_url === null ? undefined : pres.previewUrl
        };
        this.presentacionesNuevas = this.presentacionesNuevas.map((p, i) => i === index ? updated : p);
        this.presentacionesNuevasChange.emit(this.presentacionesNuevas);
    }

    eliminarNueva(index: number) {
        this.presentacionesNuevas = this.presentacionesNuevas.filter((_, i) => i !== index);
        this.presentacionesNuevasChange.emit(this.presentacionesNuevas);
    }

    // ── MODO EDITAR (persisted) ───────────────────────────────────────────────

    async agregar() {
        await this._abrirModal(
            undefined,
            async (result) => {
                let imagenPath: string | null | undefined = undefined;
                if (result.imagenRawUrl) {
                    imagenPath = await this.storageService.uploadImage(result.imagenRawUrl, this.storageSubfolder, false);
                    if (!imagenPath) return false;
                }
                const creada = await this.presentacionSvc.crearPresentacion({
                    producto_id: this.productoId!,
                    nombre: result.nombre,
                    factor_conversion: result.factor_conversion,
                    precio_venta: result.precio_venta,
                    precio_costo: result.precio_costo,
                    codigo_barras: result.codigo_barras,
                    imagen_url: imagenPath ?? undefined
                });
                if (creada?.id) {
                    this.presentaciones = [...this.presentaciones, creada];
                    if (creada.imagen_url) {
                        const url = await this.storageService.resolveImageUrl(creada.imagen_url);
                        if (url) this.presentacionesImagenUrls.set(creada.id, url);
                    }
                    this.animarPresentacion(creada.nombre);
                    this.ui.showToast(`Presentacion "${creada.nombre}" guardada`, 'success');
                    this.cambioPersistido.emit();
                    return true;
                }
                if (imagenPath) await this.storageService.deleteFile(imagenPath);
                return false;
            }
        );
    }

    async editar(pres: ProductoPresentacion) {
        await this._abrirModal(
            pres,
            async (result) => {
                let imagenPath: string | null | undefined = undefined;
                if (result.imagenRawUrl) {
                    imagenPath = await this.storageService.replaceImage(
                        result.imagenRawUrl, this.storageSubfolder, pres.imagen_url ?? null, false
                    );
                    if (!imagenPath) return false;
                } else if (result.imagen_url === null && pres.imagen_url) {
                    await this.storageService.deleteFile(pres.imagen_url);
                    imagenPath = null;
                }

                const payload: Partial<ProductoPresentacion> = {
                    nombre: result.nombre,
                    factor_conversion: result.factor_conversion,
                    precio_venta: result.precio_venta,
                    precio_costo: result.precio_costo,
                    codigo_barras: result.codigo_barras
                };
                if (imagenPath !== undefined) payload.imagen_url = imagenPath;

                await this.presentacionSvc.actualizarPresentacion(pres.id, payload);
                this.presentaciones = await this.presentacionSvc.obtenerPresentaciones(this.productoId!);
                this.presentacionesImagenUrls.delete(pres.id);
                if (imagenPath) {
                    const url = await this.storageService.resolveImageUrl(imagenPath);
                    if (url) this.presentacionesImagenUrls.set(pres.id, url);
                }
                this.ui.showToast(`Presentacion "${result.nombre}" actualizada`, 'success');
                this.cambioPersistido.emit();
                return true;
            },
            pres.imagen_url ?? null
        );
    }

    async desactivar(pres: ProductoPresentacion) {
        const alert = await this.alertCtrl.create({
            header: `¿Quitar "${pres.nombre} x${pres.factor_conversion}"?`,
            message: 'Dejara de aparecer en el POS. Las ventas realizadas con esta presentacion no se veran afectadas.',
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Quitar', role: 'destructive',
                    handler: async () => {
                        await this.presentacionSvc.desactivarPresentacion(pres.id);
                        this.presentaciones = this.presentaciones.filter(p => p.id !== pres.id);
                        this.cambioPersistido.emit();
                    }
                }
            ]
        });
        await alert.present();
    }

    async reactivar(pres: ProductoPresentacion) {
        await this.presentacionSvc.reactivarPresentacion(pres.id);
        this.presentacionesInactivas = this.presentacionesInactivas.filter(p => p.id !== pres.id);
        this.presentaciones = [...this.presentaciones, pres];
        this.animarPresentacion(pres.nombre);
        this.cambioPersistido.emit();
    }

    // ─────────────────────────────────────────────────────────────────────────

    private async _abrirModal(
        presentacionActual?: PresentacionModalResult,
        onConfirmar?: (result: PresentacionModalResult) => Promise<boolean>,
        imagenExistente?: string | null
    ): Promise<PresentacionModalResult | null> {
        const modal = await this.modalCtrl.create({
            component: PresentacionModalComponent,
            componentProps: {
                presentacionActual,
                precioBase: this.precioCosto,
                nombreProducto: this.nombreProducto.toUpperCase(),
                onConfirmar,
                imagenExistente: imagenExistente ?? null
            },
            cssClass: 'bottom-sheet-modal',
            breakpoints: [0, 1],
            initialBreakpoint: 1
        });
        await modal.present();
        const { data, role } = await modal.onDidDismiss<PresentacionModalResult>();
        return role === 'confirm' && data ? data : null;
    }
}
