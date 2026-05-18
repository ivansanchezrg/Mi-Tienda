import { Component, OnInit, OnDestroy, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SafeUrl } from '@angular/platform-browser';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import {
    AlertController, NavController, ModalController, ViewWillEnter,
    IonHeader, IonToolbar, IonButtons, IonButton, IonTitle, IonContent, IonIcon,
    IonInput, IonItem, IonCard, IonCardContent, IonSkeletonText, IonSpinner, IonToggle
} from '@ionic/angular/standalone';
import { ActivatedRoute } from '@angular/router';
import { addIcons } from 'ionicons';
import {
    arrowBackOutline, barcodeOutline, saveOutline, documentTextOutline,
    alertCircleOutline, cameraOutline, closeCircle, closeOutline,
    imagesOutline, informationCircleOutline, trashOutline,
    chevronDownOutline, chevronUpOutline, layersOutline,
    checkmarkCircleOutline, searchOutline, cubeOutline, scaleOutline,
    addOutline, refreshOutline, warningOutline, trendingUpOutline,
    trendingDownOutline, removeOutline, sparklesOutline,
    colorPaletteOutline, pricetagOutline, imageOutline
} from 'ionicons/icons';
import { CameraSource } from '@capacitor/camera';
import { BarcodeScannerService } from '../../../../core/services/barcode-scanner.service';
import { ROUTES } from '../../../../core/config/routes.config';

import { Producto, ProductoPresentacion, ProductoTemplate, Atributo, AtributoOpcion } from '../../models/producto.model';

interface PresentacionForm {
    nombre: string;
    factor_conversion: number;
    precio_venta: number;
    precio_costo: number;
    codigo_barras?: string;
    imagen_url?: string | null;
    previewUrl?: string;  // solo en memoria para mostrar thumbnail en la lista
}

// AtributoSeleccionado se usa para mostrar los atributos del producto en modo EDITAR (readonly)
interface AtributoSeleccionado {
    atributo: Atributo;
    opcion: AtributoOpcion;
}

import { CategoriaProducto } from '../../models/categoria-producto.model';
import { InventarioService } from '../../services/inventario.service';

import { NumbersOnlyDirective } from '../../../../shared/directives/numbers-only.directive';
import { CurrencyInputDirective } from '../../../../shared/directives/currency-input.directive';
import { CurrencyService } from '../../../../core/services/currency.service';
import { calcularPrecioDesdeMargen, calcularMargenDesdePrecio } from '../../../../core/utils/margen.util';
import { UiService } from '../../../../core/services/ui.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { StorageService } from '../../../../core/services/storage.service';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';
import { PresentacionModalComponent, PresentacionModalResult } from '../../components/presentacion-modal/presentacion-modal.component';
import { ScannerOverlayComponent } from '../../../../shared/components/scanner-overlay/scanner-overlay.component';

@Component({
    selector: 'app-producto-form',
    templateUrl: './producto-form.page.html',
    styleUrls: ['./producto-form.page.scss'],
    standalone: true,
    imports: [
        CommonModule, ReactiveFormsModule, FormsModule,
        IonHeader, IonToolbar, IonButtons, IonButton, IonTitle, IonContent, IonIcon,
        IonInput, IonItem, IonCard, IonCardContent, IonSkeletonText, IonSpinner, IonToggle,
        NumbersOnlyDirective, CurrencyInputDirective, ScannerOverlayComponent
    ]
})
export class ProductoFormPage implements OnInit, OnDestroy, ViewWillEnter {
    private inicializado = false;
    private navCtrl = inject(NavController);
    private route = inject(ActivatedRoute);
    private fb = inject(FormBuilder);
    private inventarioService = inject(InventarioService);
    protected currencyService = inject(CurrencyService);
    private ui = inject(UiService);
    protected storageService = inject(StorageService);
    private alertCtrl = inject(AlertController);
    private modalCtrl = inject(ModalController);
    private logger = inject(LoggerService);
    protected barcodeScanner = inject(BarcodeScannerService);
    private cdr = inject(ChangeDetectorRef);

    productoForm!: FormGroup;
    escaneando = false;
    modo: 'CREAR' | 'EDITAR' = 'CREAR';
    guardando = false;
    cargando = true;
    formSubmitted = false;
    margenPct: number = 20;
    margenAbsoluto = 0;

    producto?: Producto;
    categorias: CategoriaProducto[] = [];
    codigoBarrasInicial?: string;

    // Presentaciones en modo EDITAR (desde BD)
    presentaciones: ProductoPresentacion[] = [];
    presentacionesInactivas: ProductoPresentacion[] = [];
    mostrarInactivas = false;
    presentacionesImagenUrls = new Map<string, string>();  // id → signedUrl
    // Presentaciones en modo CREAR (en memoria, aun sin producto_id)
    presentacionesNuevas: PresentacionForm[] = [];
    // Nombre de la presentacion recien agregada para disparar animacion
    presentacionRecienAgregada: string | null = null;

    // Template + atributos — solo lectura en modo EDITAR
    templateSeleccionado: ProductoTemplate | null = null;
    variantesHermanas: Producto[] = [];
    atributosSeleccionados: AtributoSeleccionado[] = [];

    // Imagen del producto
    fotoPreviewUrl: SafeUrl | null = null;   // para <img [src]>
    private fotoRawUrl: string | null = null; // para uploadImage()
    imagenUrlExistente: string | null = null;
    private imagenPathAnterior: string | null = null;
    private fotoNueva = false;
    private fotoEliminada = false;

    constructor() {
        addIcons({
            arrowBackOutline, barcodeOutline, saveOutline, documentTextOutline,
            alertCircleOutline, cameraOutline, closeCircle, closeOutline,
            imagesOutline, informationCircleOutline, trashOutline,
            chevronDownOutline, chevronUpOutline, layersOutline,
            checkmarkCircleOutline, searchOutline, cubeOutline, scaleOutline,
            addOutline, refreshOutline, warningOutline, trendingUpOutline,
            trendingDownOutline, removeOutline, sparklesOutline,
            colorPaletteOutline, pricetagOutline, imageOutline
        });
    }

    async ngOnInit() {
        const productoId = this.route.snapshot.paramMap.get('id');
        this.codigoBarrasInicial = this.route.snapshot.queryParamMap.get('codigo') || undefined;
        this.modo = productoId ? 'EDITAR' : 'CREAR';

        const [categorias, producto] = await Promise.all([
            this.inventarioService.obtenerCategorias(),
            productoId ? this.inventarioService.obtenerProductoPorId(productoId) : Promise.resolve(null)
        ]);

        this.categorias = categorias;
        if (producto) {
            this.producto = producto;
            if (producto.imagen_url) {
                this.imagenPathAnterior = producto.imagen_url;
                this.imagenUrlExistente = await this.storageService.resolveImageUrl(producto.imagen_url);
            }
            [this.presentaciones, this.presentacionesInactivas] = await Promise.all([
                this.inventarioService.obtenerPresentaciones(producto.id),
                this.inventarioService.obtenerPresentacionesInactivas(producto.id)
            ]);
            await this.resolverImagenesPresentaciones([...this.presentaciones, ...this.presentacionesInactivas]);

            // Si tiene template, cargar datos readonly
            if (producto.producto_template) {
                this.templateSeleccionado = producto.producto_template;
                this.variantesHermanas = await this.inventarioService.obtenerSKUsDelTemplate(
                    producto.producto_template.id, producto.id
                );
                const atributosRaw = await this.inventarioService.obtenerAtributosProducto(producto.id);
                this.atributosSeleccionados = atributosRaw
                    .filter(pa => pa.atributo_opcion?.atributo)
                    .map(pa => ({
                        atributo: pa.atributo_opcion!.atributo!,
                        opcion: pa.atributo_opcion!
                    }));
            }
        }
        this.cargando = false;
        this.inicializado = true;

        this.initForm();
        this.cdr.detectChanges();
    }

    async ionViewWillEnter() {
        if (this.inicializado && this.producto) {
            const productoActualizado = await this.inventarioService.obtenerProductoPorId(this.producto.id);
            if (productoActualizado) {
                this.producto.stock_actual = productoActualizado.stock_actual;
                this.productoForm.patchValue({ stock_actual: productoActualizado.stock_actual });
            }
        }
    }

    private initForm() {
        // SKUs de variante no tienen categoria_id propio — la heredan del template
        const categoriaId = this.producto?.categoria_id
            ?? this.producto?.producto_template?.categoria_id
            ?? null;

        this.productoForm = this.fb.group({
            codigo_barras: [this.codigoBarrasInicial || this.producto?.codigo_barras || ''],
            nombre: [this.producto?.nombre || '', [Validators.required, Validators.minLength(3), Validators.maxLength(100)]],
            categoria_id: [categoriaId, [Validators.required]],
            precio_costo: [this.producto?.precio_costo || '', [Validators.required, Validators.min(0.01)]],
            precio_venta: [this.producto?.precio_venta || '', [Validators.required, Validators.min(0.01)]],
            stock_actual: [this.producto?.stock_actual || '', [Validators.required, Validators.min(0)]],
            stock_minimo: [this.producto?.stock_minimo || 5, [Validators.required, Validators.min(0)]],
            tiene_iva: [this.producto?.tiene_iva ?? true],
            tipo_venta: [this.producto?.tipo_venta || 'UNIDAD'],
            unidad_medida: [this.producto?.unidad_medida || 'und'],
            producto_template_id: [this.producto?.producto_template_id || null]
        });

        // No marcar touched aqui — se marca al intentar guardar (markAllAsTouched)
        // o al cerrar el selector sin elegir (abrirSelectorCategoria)

        if (this.producto?.precio_costo && this.producto?.precio_venta) {
            this.margenPct = calcularMargenDesdePrecio(this.producto.precio_costo, this.producto.precio_venta);
            this.margenAbsoluto = this.producto.precio_venta - this.producto.precio_costo;
        }
    }

    get costoActual(): number {
        const raw = this.currencyService.parse(this.productoForm?.get('precio_costo')?.value ?? 0);
        return Math.round(raw * 100) / 100;
    }

    onCostoChange() {
        setTimeout(() => {
            const costo = this.costoActual;
            if (costo <= 0) {
                this.productoForm.get('precio_venta')?.setValue('', { emitEvent: false });
                this.margenPct = 20;
                this.margenAbsoluto = 0;
                return;
            }
            this.recalcularPrecioDesdeSlider();
        });
    }

    onPrecioVentaChange() {
        setTimeout(() => {
            const costo = this.costoActual;
            const ventaRaw = this.currencyService.parse(this.productoForm?.get('precio_venta')?.value ?? 0);
            const venta = Math.round(ventaRaw * 100) / 100;
            this.margenPct = calcularMargenDesdePrecio(costo, venta);
            this.margenAbsoluto = venta > costo ? Math.round((venta - costo) * 100) / 100 : 0;
        });
    }

    private recalcularPrecioDesdeSlider() {
        const costo = this.costoActual;
        if (costo <= 0 || this.margenPct <= 0) return;
        const precio = calcularPrecioDesdeMargen(costo, this.margenPct);
        this.productoForm.get('precio_venta')?.setValue(
            this.currencyService.format(precio),
            { emitEvent: false }
        );
        this.margenAbsoluto = Math.round((precio - costo) * 100) / 100;
    }

    get categoriaLabel(): string {
        const id = this.productoForm?.get('categoria_id')?.value;
        if (!id) return 'Seleccionar categoria *';
        return this.categorias.find(c => c.id === id)?.nombre || 'Seleccionar categoria *';
    }

    async abrirSelectorCategoria() {
        const groups: ModalOptionGroup[] = [{
            title: 'Categorias',
            options: this.categorias.map(cat => ({
                label: cat.nombre,
                value: String(cat.id)
            }))
        }];

        const currentId = this.productoForm.get('categoria_id')?.value;

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

        this.productoForm.get('categoria_id')?.markAsTouched();
        if (data) {
            const ctrl = this.productoForm.get('categoria_id');
            ctrl?.setValue(data);
            ctrl?.markAsDirty();
            this.cdr.detectChanges();
        }
    }

    volver() {
        if (this.modo === 'CREAR') {
            this.navCtrl.navigateBack(ROUTES.inventario.nuevo);
        } else {
            this.navCtrl.navigateBack(ROUTES.inventario.root);
        }
    }

    async guardar() {
        this.formSubmitted = true;
        if (this.productoForm.invalid || this.guardando) {
            this.productoForm.markAllAsTouched();
            return;
        }

        this.guardando = true;

        const value = this.productoForm.value;
        const isPeso = value.tipo_venta === 'PESO';

        try {
            let imagenUrl: string | null = null;
            if (this.fotoNueva && this.fotoRawUrl) {
                const subfolder = this.sanitizarSubfolder(this.obtenerNombreCategoria(value.categoria_id));
                const oldPath = this.modo === 'EDITAR' ? (this.imagenPathAnterior ?? null) : null;
                imagenUrl = await this.storageService.replaceImage(this.fotoRawUrl, `productos/${subfolder}`, oldPath, false);
                if (!imagenUrl) {
                    this.guardando = false;
                    return;
                }
            }

            if (this.modo === 'CREAR') {
                // Subir imágenes pendientes de presentaciones en paralelo
                const subfolder = this.sanitizarSubfolder(this.obtenerNombreCategoria(value.categoria_id));
                const presentacionesConImagen = await Promise.all(
                    this.presentacionesNuevas.map(async p => {
                        let imagen_url = p.imagen_url ?? undefined;
                        if (imagen_url?.startsWith('__pending__')) {
                            const rawUrl = imagen_url.slice('__pending__'.length);
                            const path = await this.storageService.uploadImage(rawUrl, `productos/${subfolder}`, false);
                            imagen_url = path ?? undefined;
                        }
                        return {
                            nombre: p.nombre,
                            factor_conversion: p.factor_conversion,
                            precio_venta: p.precio_venta,
                            precio_costo: p.precio_costo,
                            codigo_barras: p.codigo_barras,
                            imagen_url
                        };
                    })
                );

                const resultado = await this.inventarioService.crearProductoSimple({
                    nombre: value.nombre,
                    categoria_id: value.categoria_id,
                    tiene_iva: value.tiene_iva,
                    tipo_venta: value.tipo_venta,
                    unidad_medida: isPeso ? value.unidad_medida : 'und',
                    codigo_barras: value.codigo_barras?.trim() || undefined,
                    imagen_url: imagenUrl || undefined,
                    precio_costo: this.currencyService.parse(value.precio_costo),
                    precio_venta: this.currencyService.parse(value.precio_venta),
                    stock_actual: Number(value.stock_actual) || 0,
                    stock_minimo: Number(value.stock_minimo) || 0,
                    presentaciones: presentacionesConImagen
                });

                if (resultado.ok) {
                    this.navCtrl.navigateBack(ROUTES.inventario.root);
                }
            } else {
                const productoPayload: Partial<Producto> = {
                    ...value,
                    codigo_barras: value.codigo_barras?.trim() || null,
                    precio_costo: this.currencyService.parse(value.precio_costo),
                    precio_venta: this.currencyService.parse(value.precio_venta),
                    stock_actual: Number(value.stock_actual) || 0,
                    stock_minimo: Number(value.stock_minimo) || 0,
                    tipo_venta: value.tipo_venta,
                    unidad_medida: isPeso ? value.unidad_medida : 'und',
                    producto_template_id: value.producto_template_id || null
                };

                if (imagenUrl) {
                    productoPayload.imagen_url = imagenUrl;
                } else if (this.fotoEliminada) {
                    if (this.imagenPathAnterior) await this.storageService.deleteFile(this.imagenPathAnterior);
                    productoPayload.imagen_url = null;
                }

                await this.inventarioService.actualizarProducto(this.producto!.id, productoPayload);
                this.productoForm.markAsPristine();
                this.navCtrl.navigateBack(ROUTES.inventario.root);
            }
        } catch (error) {
            this.logger.error('ProductoFormPage', 'Error guardando producto', error);
        } finally {
            this.guardando = false;
        }
    }

    abrirKardex() {
        if (!this.producto) return;
        this.navCtrl.navigateForward(ROUTES.inventario.kardex(this.producto.id), {
            queryParams: {
                nombre: this.producto.nombre,
                stock: this.producto.stock_actual,
            }
        });
    }

    async desactivarProducto() {
        if (!this.producto) return;
        const alert = await this.alertCtrl.create({
            header: `\u00bfQuitar "${this.producto.nombre}"?`,
            message: 'Dejara de aparecer en el inventario y el POS. Puedes reactivarlo cuando quieras desde la lista de productos.',
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Quitar',
                    role: 'destructive',
                    handler: async () => {
                        await this.inventarioService.desactivarProducto(this.producto!.id);
                        this.navCtrl.navigateBack(ROUTES.inventario.root);
                    }
                }
            ]
        });
        await alert.present();
    }

    async reactivarProducto() {
        if (!this.producto) return;
        const alert = await this.alertCtrl.create({
            header: 'Reactivar producto',
            message: `"${this.producto.nombre}" volvera a aparecer en el inventario y el POS.`,
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Reactivar',
                    handler: async () => {
                        const actualizado = await this.inventarioService.reactivarProducto(this.producto!.id);
                        if (actualizado?.id) {
                            this.producto!.activo = true;
                        }
                    }
                }
            ]
        });
        await alert.present();
    }

    async escanearCodigo() {
        this.escaneando = true;
        const codigo = await this.barcodeScanner.scan();
        this.escaneando = false;
        if (!codigo) return;
        this.productoForm.patchValue({ codigo_barras: codigo });
        this.ui.showToast(`Codigo capturado: ${codigo}`, 'success');
    }

    async cerrarEscaner() {
        await this.barcodeScanner.stop();
        this.escaneando = false;
    }

    async seleccionarFoto() {
        const buttons: any[] = [];
        if (this.storageService.isNative) {
            buttons.push({ text: 'Tomar foto', handler: () => this.tomarFoto(CameraSource.Camera) });
        }
        buttons.push({ text: 'Galeria', handler: () => this.tomarFoto(CameraSource.Photos) });
        buttons.push({ text: 'Cancelar', role: 'cancel' });

        const alert = await this.alertCtrl.create({ header: 'Imagen del producto', buttons });
        await alert.present();
    }

    private async tomarFoto(source: CameraSource) {
        const result = await this.storageService.capturarFoto(source);
        if (!result) return;
        this.fotoPreviewUrl = result.previewUrl;
        this.fotoRawUrl = result.rawUrl;
        this.imagenUrlExistente = null;
        this.fotoNueva = true;
        this.fotoEliminada = false;
        this.productoForm.markAsDirty();
    }

    removerFoto() {
        if (this.imagenPathAnterior && !this.fotoNueva) {
            this.fotoEliminada = true;
        }
        this.fotoPreviewUrl = null;
        this.fotoRawUrl = null;
        this.imagenUrlExistente = null;
        this.fotoNueva = false;
        this.productoForm.markAsDirty();
    }

    private obtenerNombreCategoria(categoriaId: string): string {
        const cat = this.categorias.find(c => c.id === categoriaId);
        return cat?.nombre || 'sin-categoria';
    }

    private sanitizarSubfolder(nombre: string): string {
        return nombre
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }

    // ==========================================
    // TIPO VENTA
    // ==========================================

    onTipoVentaChange(tipo: string) {
        if (tipo === 'PESO') {
            this.productoForm.patchValue({ unidad_medida: 'lb' });
        } else {
            this.productoForm.patchValue({ unidad_medida: 'und' });
        }
    }

    // ==========================================
    // PRESENTACIONES — modo CREAR (en memoria)
    // ==========================================

    async agregarPresentacionNueva() {
        if (!this.productoForm.get('nombre')?.value?.trim()) {
            this.ui.showToast('Ingresa el nombre del producto antes de agregar presentaciones', 'warning');
            return;
        }
        const result = await this.abrirPresentacionModal(
            this.presentacionesNuevas.map(p => p.nombre)
        );
        if (!result) return;

        // Imagen se sube al guardar el producto (junto con todo lo demás)
        const pres: PresentacionForm = {
            nombre: result.nombre,
            factor_conversion: result.factor_conversion,
            precio_venta: result.precio_venta,
            precio_costo: result.precio_costo,
            codigo_barras: result.codigo_barras,
            imagen_url: result.imagenRawUrl ? `__pending__${result.imagenRawUrl}` : result.imagen_url,
            previewUrl: result.imagenRawUrl || undefined
        };
        this.presentacionesNuevas = [...this.presentacionesNuevas, pres];
        this.animarPresentacion(result.nombre);
    }

    async editarPresentacionNueva(index: number) {
        const pres = this.presentacionesNuevas[index];
        const nombresOtros = this.presentacionesNuevas.filter((_, i) => i !== index).map(p => p.nombre);
        // Resolver imagen existente para mostrar preview
        const imagenExistente = pres.imagen_url?.startsWith('__pending__')
            ? null
            : pres.imagen_url ?? null;
        const result = await this.abrirPresentacionModal(nombresOtros, pres, undefined, imagenExistente);
        if (!result) return;
        const updated: PresentacionForm = {
            nombre: result.nombre,
            factor_conversion: result.factor_conversion,
            precio_venta: result.precio_venta,
            precio_costo: result.precio_costo,
            codigo_barras: result.codigo_barras,
            imagen_url: result.imagenRawUrl
                ? `__pending__${result.imagenRawUrl}`
                : result.imagen_url !== undefined
                    ? result.imagen_url
                    : pres.imagen_url,
            previewUrl: result.imagenRawUrl
                ? result.imagenRawUrl
                : result.imagen_url === null
                    ? undefined
                    : pres.previewUrl
        };
        this.presentacionesNuevas = this.presentacionesNuevas.map((p, i) => i === index ? updated : p);
    }

    eliminarPresentacionNueva(index: number) {
        this.presentacionesNuevas = this.presentacionesNuevas.filter((_, i) => i !== index);
    }

    // ==========================================
    // PRESENTACIONES — modo EDITAR (desde BD)
    // ==========================================

    async agregarPresentacion() {
        await this.abrirPresentacionModal(
            this.presentaciones.map(p => p.nombre),
            undefined,
            async (result) => {
                let imagenPath: string | null | undefined = undefined;
                if (result.imagenRawUrl) {
                    const subfolder = this.sanitizarSubfolder(this.obtenerNombreCategoria(this.productoForm.get('categoria_id')?.value));
                    imagenPath = await this.storageService.uploadImage(result.imagenRawUrl, `productos/${subfolder}`, false);
                    if (!imagenPath) return false;
                }
                const creada = await this.inventarioService.crearPresentacion({
                    producto_id: this.producto!.id,
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
                    return true;
                }
                if (imagenPath) await this.storageService.deleteFile(imagenPath);
                return false;
            }
        );
    }

    private animarPresentacion(nombre: string) {
        this.presentacionRecienAgregada = nombre;
        setTimeout(() => { this.presentacionRecienAgregada = null; }, 400);
    }

    async editarPresentacion(pres: ProductoPresentacion) {
        const nombresOtros = this.presentaciones.filter(p => p.id !== pres.id).map(p => p.nombre);
        await this.abrirPresentacionModal(
            nombresOtros,
            pres,
            async (result) => {
                const subfolder = this.sanitizarSubfolder(this.obtenerNombreCategoria(this.productoForm.get('categoria_id')?.value));
                let imagenPath: string | null | undefined = undefined;

                if (result.imagenRawUrl) {
                    imagenPath = await this.storageService.replaceImage(
                        result.imagenRawUrl,
                        `productos/${subfolder}`,
                        pres.imagen_url ?? null,
                        false
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

                await this.inventarioService.actualizarPresentacion(pres.id, payload);
                this.presentaciones = await this.inventarioService.obtenerPresentaciones(this.producto!.id);
                // Actualizar mapa de URLs de imagen tras edicion
                this.presentacionesImagenUrls.delete(pres.id);
                if (imagenPath) {
                    const url = await this.storageService.resolveImageUrl(imagenPath);
                    if (url) this.presentacionesImagenUrls.set(pres.id, url);
                } else if (imagenPath === null) {
                    // imagen eliminada — ya borrada del mapa
                }
                this.ui.showToast(`Presentacion "${result.nombre}" actualizada`, 'success');
                return true;
            },
            pres.imagen_url ?? null
        );
    }

    async reactivarPresentacion(pres: ProductoPresentacion) {
        await this.inventarioService.reactivarPresentacion(pres.id);
        this.presentacionesInactivas = this.presentacionesInactivas.filter(p => p.id !== pres.id);
        this.presentaciones = [...this.presentaciones, pres];
        this.animarPresentacion(pres.nombre);
    }

    async eliminarPresentacion(pres: ProductoPresentacion) {
        const alert = await this.alertCtrl.create({
            header: `\u00bfQuitar "${pres.nombre}"?`,
            message: 'Dejara de aparecer en el POS. Las ventas realizadas con esta presentacion no se veran afectadas.',
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Quitar',
                    role: 'destructive',
                    handler: async () => {
                        await this.inventarioService.desactivarPresentacion(pres.id);
                        this.presentaciones = this.presentaciones.filter(p => p.id !== pres.id);
                    }
                }
            ]
        });
        await alert.present();
    }

    private async resolverImagenesPresentaciones(presentaciones: ProductoPresentacion[]) {
        await Promise.all(
            presentaciones
                .filter(p => p.imagen_url)
                .map(async p => {
                    const url = await this.storageService.resolveImageUrl(p.imagen_url);
                    if (url) this.presentacionesImagenUrls.set(p.id, url);
                })
        );
    }

    private async abrirPresentacionModal(
        nombresExistentes: string[],
        presentacionActual?: PresentacionModalResult,
        onConfirmar?: (result: PresentacionModalResult) => Promise<boolean>,
        imagenExistente?: string | null
    ): Promise<PresentacionModalResult | null> {
        const nombreProducto = (this.productoForm.get('nombre')?.value ?? '').trim().toUpperCase()
            || this.producto?.nombre?.toUpperCase()
            || '';
        const modal = await this.modalCtrl.create({
            component: PresentacionModalComponent,
            componentProps: {
                nombresExistentes,
                presentacionActual,
                precioBase: this.currencyService.parse(this.productoForm.get('precio_costo')?.value ?? 0),
                nombreProducto,
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

    get unidadMedidaLabel(): string {
        const um = this.productoForm?.get('unidad_medida')?.value;
        const labels: Record<string, string> = { kg: 'Kilogramo', lb: 'Libra', g: 'Gramo', ml: 'Mililitro', L: 'Litro' };
        return labels[um] || um;
    }

    esCampoInvalido(campo: string): boolean {
        const control = this.productoForm.get(campo);
        return !!(control && control.invalid && (control.dirty || control.touched));
    }

    ngOnDestroy() {
        if (this.escaneando) this.cerrarEscaner();
    }
}
