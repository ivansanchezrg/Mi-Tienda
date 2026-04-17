import { Component, OnInit, OnDestroy, inject, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators, ReactiveFormsModule } from '@angular/forms';
import { IonicModule, AlertController, NavController, ViewWillEnter } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { addIcons } from 'ionicons';
import { arrowBackOutline, barcodeOutline, saveOutline, documentTextOutline, alertCircleOutline, cameraOutline, closeCircle, closeOutline, imagesOutline, informationCircleOutline, trashOutline, chevronDownOutline, layersOutline, checkmarkCircleOutline, searchOutline, cubeOutline, scaleOutline } from 'ionicons/icons';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

import { Producto, ProductoPresentacion, TipoVenta } from '../../models/producto.model';
import { CategoriaProducto } from '../../models/categoria-producto.model';
import { InventarioService } from '../../services/inventario.service';

import { NumbersOnlyDirective } from '../../../../shared/directives/numbers-only.directive';
import { CurrencyInputDirective } from '../../../../shared/directives/currency-input.directive';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { StorageService } from '../../../../core/services/storage.service';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';
import { ModalController } from '@ionic/angular';

@Component({
    selector: 'app-producto-form',
    templateUrl: './producto-form.page.html',
    styleUrls: ['./producto-form.page.scss'],
    standalone: true,
    imports: [IonicModule, CommonModule, ReactiveFormsModule, NumbersOnlyDirective, CurrencyInputDirective]
})
export class ProductoFormPage implements OnInit, OnDestroy, ViewWillEnter {
    private inicializado = false;
    private navCtrl = inject(NavController);
    private route = inject(ActivatedRoute);
    private fb = inject(FormBuilder);
    private inventarioService = inject(InventarioService);
    public currencyService = inject(CurrencyService);
    private ui = inject(UiService);
    private ngZone = inject(NgZone);
    private storageService = inject(StorageService);
    private alertCtrl = inject(AlertController);
    private modalCtrl = inject(ModalController);
    private logger = inject(LoggerService);

    productoForm!: FormGroup;
    escaneando = false;
    modo: 'CREAR' | 'EDITAR' = 'CREAR';
    guardando = false;
    cargando = true;
    formSubmitted = false;
    margenPorcentaje = 0;
    margenAbsoluto = 0;

    producto?: Producto;
    categorias: CategoriaProducto[] = [];
    codigoBarrasInicial?: string;

    // Presentaciones (solo en modo EDITAR)
    presentaciones: ProductoPresentacion[] = [];

    // Imagen del producto
    fotoPreview: string | null = null;       // DataURL para preview local
    imagenUrlExistente: string | null = null; // URL pública si ya tenía imagen
    private imagenPathAnterior: string | null = null; // Path en storage para eliminar si se cambia
    private fotoNueva = false;               // true si el usuario seleccionó/cambió foto
    private fotoEliminada = false;           // true si el usuario quitó la foto existente

    private audioCtx: AudioContext | null = null;

    constructor() {
        addIcons({ arrowBackOutline, barcodeOutline, saveOutline, documentTextOutline, alertCircleOutline, cameraOutline, closeCircle, closeOutline, imagesOutline, informationCircleOutline, trashOutline, chevronDownOutline, layersOutline, checkmarkCircleOutline, searchOutline, cubeOutline, scaleOutline });
    }

    async ngOnInit() {
        const productoId = this.route.snapshot.paramMap.get('id');
        this.codigoBarrasInicial = this.route.snapshot.queryParamMap.get('codigo') || undefined;
        this.modo = productoId ? 'EDITAR' : 'CREAR';

        // Cargar categorías + producto (si editar) en paralelo
        const [categorias, producto] = await Promise.all([
            this.inventarioService.obtenerCategorias(),
            productoId ? this.inventarioService.obtenerProductoPorId(productoId) : Promise.resolve(null)
        ]);

        this.categorias = categorias;
        if (producto) {
            this.producto = producto;
            // Si el producto ya tiene imagen, obtener URL pública
            if (producto.imagen_url) {
                this.imagenPathAnterior = producto.imagen_url;
                this.imagenUrlExistente = this.storageService.getPublicUrl(producto.imagen_url, 'productos');
            }
            // Cargar presentaciones del producto
            this.presentaciones = await this.inventarioService.obtenerPresentaciones(producto.id);
        }
        this.cargando = false;
        this.inicializado = true;

        this.initForm();
    }

    async ionViewWillEnter() {
        // Al volver del Kárdex, refrescar el stock actual del producto
        if (this.inicializado && this.producto) {
            const productoActualizado = await this.inventarioService.obtenerProductoPorId(this.producto.id);
            if (productoActualizado) {
                this.producto.stock_actual = productoActualizado.stock_actual;
                this.productoForm.patchValue({ stock_actual: productoActualizado.stock_actual });
            }
        }
    }

    private initForm() {
        this.productoForm = this.fb.group({
            codigo_barras: [this.codigoBarrasInicial || this.producto?.codigo_barras || ''],
            nombre: [this.producto?.nombre || '', [Validators.required, Validators.minLength(3), Validators.maxLength(100)]],
            categoria_id: [this.producto?.categoria_id || null, [Validators.required]],
            precio_costo: [this.producto?.precio_costo || '', [Validators.required, Validators.min(0.01)]],
            precio_venta: [this.producto?.precio_venta || '', [Validators.required, Validators.min(0.01)]],
            stock_actual: [this.producto?.stock_actual || '', [Validators.required, Validators.min(0)]],
            stock_minimo: [this.producto?.stock_minimo || 5, [Validators.required, Validators.min(0)]],
            tiene_iva: [this.producto?.tiene_iva ?? true],
            tipo_venta: [this.producto?.tipo_venta || 'UNIDAD'],
            unidad_medida: [this.producto?.unidad_medida || 'und']
        }, { validators: this.ventaMayorCostoValidator.bind(this) });

        // En modo CREAR, marcar categoría como touched para que se vea el error de inmediato
        if (this.modo === 'CREAR') {
            this.productoForm.get('categoria_id')?.markAsTouched();
        }

        // Cálculo dinámico del margen de ganancia
        this.productoForm.valueChanges.subscribe(v => this.calcularMargen(v));
        // Al editar, los valores ya están cargados — calcular margen inicial
        this.calcularMargen(this.productoForm.value);
    }

    private calcularMargen(v: any) {
        const costo = this.currencyService.parse(v.precio_costo);
        const venta = this.currencyService.parse(v.precio_venta);
        if (costo > 0 && venta > 0 && venta >= costo) {
            this.margenAbsoluto = venta - costo;
            this.margenPorcentaje = Math.round(((venta - costo) / costo) * 100);
        } else {
            this.margenAbsoluto = 0;
            this.margenPorcentaje = 0;
        }
    }

    private ventaMayorCostoValidator(group: AbstractControl): ValidationErrors | null {
        const costo = this.currencyService.parse(group.get('precio_costo')?.value);
        const venta = this.currencyService.parse(group.get('precio_venta')?.value);
        if (costo > 0 && venta > 0 && venta < costo) {
            return { ventaMenorQueCosto: true };
        }
        return null;
    }

    get categoriaLabel(): string {
        const id = this.productoForm?.get('categoria_id')?.value;
        if (!id) return 'Seleccionar categoría *';
        return this.categorias.find(c => c.id === Number(id))?.nombre || 'Seleccionar categoría *';
    }

    async abrirSelectorCategoria() {
        const groups: ModalOptionGroup[] = [{
            title: 'Categorías',
            options: this.categorias.map(cat => ({
                label: cat.nombre,
                value: String(cat.id)
            }))
        }];

        const currentId = this.productoForm.get('categoria_id')?.value;

        const modal = await this.modalCtrl.create({
            component: OptionsModalComponent,
            componentProps: {
                title: 'Categoría del producto',
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
            this.productoForm.patchValue({ categoria_id: Number(data) });
        }
    }

    volver() {
        this.navCtrl.back();
    }

    async guardar() {
        this.formSubmitted = true;
        if (this.productoForm.invalid || this.guardando) {
            this.productoForm.markAllAsTouched();
            return;
        }

        this.guardando = true;

        const value = this.productoForm.value;
        const codigoBarras = value.codigo_barras?.trim() ? value.codigo_barras.trim() : null;

        const isPeso = value.tipo_venta === 'PESO';

        const productoPayload: Partial<Producto> = {
            ...value,
            codigo_barras: codigoBarras,
            precio_costo: this.currencyService.parse(value.precio_costo),
            precio_venta: this.currencyService.parse(value.precio_venta),
            stock_actual: Number(value.stock_actual) || 0,
            stock_minimo: Number(value.stock_minimo) || 0,
            activo: this.producto?.activo ?? true,
            tipo_venta: value.tipo_venta,
            unidad_medida: isPeso ? value.unidad_medida : 'und'
        };

        try {
            // Subir imagen nueva si el usuario seleccionó una
            if (this.fotoNueva && this.fotoPreview) {
                const categoriaNombre = this.obtenerNombreCategoria(value.categoria_id);
                const subfolder = this.sanitizarSubfolder(categoriaNombre);
                const imagenPath = await this.storageService.uploadImage(this.fotoPreview, 'productos', subfolder, false);

                if (!imagenPath) {
                    // StorageService ya muestra toast descriptivo del error
                    this.guardando = false;
                    return;
                }

                // Si había imagen anterior, eliminarla
                if (this.imagenPathAnterior) {
                    await this.storageService.deleteFile(this.imagenPathAnterior, 'productos');
                }

                productoPayload.imagen_url = imagenPath;
            } else if (this.fotoEliminada) {
                // El usuario quitó la foto existente
                if (this.imagenPathAnterior) {
                    await this.storageService.deleteFile(this.imagenPathAnterior, 'productos');
                }
                productoPayload.imagen_url = null as any;
            }

            if (this.modo === 'CREAR') {
                await this.inventarioService.crearProducto(productoPayload);
            } else {
                await this.inventarioService.actualizarProducto(this.producto!.id, productoPayload);
            }
            // El servicio emite el evento → la lista se actualiza reactivamente
            this.navCtrl.back();
        } catch (error) {
            this.logger.error('ProductoFormPage', 'Error guardando producto', error);
        } finally {
            this.guardando = false;
        }
    }

    abrirKardex() {
        if (!this.producto) return;
        this.navCtrl.navigateForward(`/inventario/kardex/${this.producto.id}`, {
            queryParams: {
                nombre: this.producto.nombre,
                stock: this.producto.stock_actual
            }
        });
    }

    async desactivarProducto() {
        if (!this.producto) return;
        const alert = await this.alertCtrl.create({
            header: 'Desactivar producto',
            message: `"${this.producto.nombre}" dejará de aparecer en el inventario y POS, pero se conservará su historial de ventas y kardex.`,
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Desactivar',
                    role: 'destructive',
                    handler: async () => {
                        await this.inventarioService.desactivarProducto(this.producto!.id);
                        this.navCtrl.back();
                    }
                }
            ]
        });
        await alert.present();
    }

    async escanearCodigo() {
        const { camera } = await BarcodeScanner.requestPermissions();
        if (camera !== 'granted') {
            this.ui.showToast('Permiso de cámara denegado', 'warning');
            return;
        }

        this.escaneando = true;
        document.body.classList.add('scanner-active');

        try {
            await BarcodeScanner.addListener('barcodesScanned', (event) => {
                this.ngZone.run(async () => {
                    const codigo = event.barcodes[0]?.rawValue;
                    if (!codigo) return;
                    navigator.vibrate?.(40);
                    this.playBeep();
                    this.productoForm.patchValue({ codigo_barras: codigo });
                    this.ui.showToast(`Código capturado: ${codigo}`, 'success');
                    await this.cerrarEscaner();
                });
            });
            await BarcodeScanner.startScan({
                formats: [
                    BarcodeFormat.Ean13, BarcodeFormat.Ean8,
                    BarcodeFormat.Code128, BarcodeFormat.UpcA,
                    BarcodeFormat.UpcE, BarcodeFormat.Code39,
                ]
            });
        } catch {
            await this.cerrarEscaner();
        }
    }

    async cerrarEscaner() {
        await BarcodeScanner.removeAllListeners();
        await BarcodeScanner.stopScan();
        document.body.classList.remove('scanner-active');
        this.escaneando = false;
    }

    async seleccionarFoto() {
        const alert = await this.alertCtrl.create({
            header: 'Imagen del producto',
            buttons: [
                {
                    text: 'Tomar foto',
                    handler: () => this.tomarFoto(CameraSource.Camera)
                },
                {
                    text: 'Galería',
                    handler: () => this.tomarFoto(CameraSource.Photos)
                },
                { text: 'Cancelar', role: 'cancel' }
            ]
        });
        await alert.present();
    }

    private async tomarFoto(source: CameraSource) {
        try {
            const image = await Camera.getPhoto({
                quality: 80,
                allowEditing: false,
                resultType: CameraResultType.DataUrl,
                source,
                width: 1200,
                height: 1600,
                correctOrientation: true
            });

            this.fotoPreview = image.dataUrl || null;
            this.imagenUrlExistente = null;
            this.fotoNueva = true;
            this.fotoEliminada = false;
        } catch {
            // El usuario canceló — no mostrar error
        }
    }

    removerFoto() {
        if (this.imagenPathAnterior && !this.fotoNueva) {
            // Estaba mostrando la imagen existente → marcar para eliminar
            this.fotoEliminada = true;
        }
        this.fotoPreview = null;
        this.imagenUrlExistente = null;
        this.fotoNueva = false;
    }

    private obtenerNombreCategoria(categoriaId: number): string {
        const cat = this.categorias.find(c => c.id === Number(categoriaId));
        return cat?.nombre || 'sin-categoria';
    }

    private sanitizarSubfolder(nombre: string): string {
        return nombre
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
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
    // PRESENTACIONES (solo EDITAR)
    // ==========================================

    async agregarPresentacion() {
        const alert = await this.alertCtrl.create({
            header: 'Nueva presentacion',
            inputs: [
                { name: 'nombre', type: 'text', placeholder: 'Ej. Cajetilla x10' },
                { name: 'factor_conversion', type: 'number', placeholder: 'Unidades por paquete (ej. 10)', min: 1 },
                { name: 'precio_venta', type: 'number', placeholder: 'Precio de venta ($)', min: 0.01 },
                { name: 'codigo_barras', type: 'text', placeholder: 'Codigo de barras (opcional)' }
            ],
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Crear',
                    handler: async (data) => {
                        if (!data.nombre?.trim() || !data.factor_conversion || !data.precio_venta) {
                            this.ui.showToast('Completa nombre, factor y precio', 'warning');
                            return false;
                        }
                        const pres = await this.inventarioService.crearPresentacion({
                            producto_id: this.producto!.id,
                            nombre: data.nombre.trim(),
                            factor_conversion: Math.round(Number(data.factor_conversion)),
                            precio_venta: Number(data.precio_venta),
                            codigo_barras: data.codigo_barras?.trim() || null
                        });
                        if (pres?.id) {
                            this.presentaciones.push(pres);
                        }
                        return true;
                    }
                }
            ]
        });
        await alert.present();
    }

    async editarPresentacion(pres: ProductoPresentacion) {
        const alert = await this.alertCtrl.create({
            header: 'Editar presentacion',
            inputs: [
                { name: 'nombre', type: 'text', value: pres.nombre, placeholder: 'Nombre' },
                { name: 'factor_conversion', type: 'number', value: pres.factor_conversion, placeholder: 'Unidades por paquete', min: 1 },
                { name: 'precio_venta', type: 'number', value: pres.precio_venta, placeholder: 'Precio de venta ($)', min: 0.01 },
                { name: 'codigo_barras', type: 'text', value: pres.codigo_barras || '', placeholder: 'Codigo de barras (opcional)' }
            ],
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Guardar',
                    handler: async (data) => {
                        if (!data.nombre?.trim() || !data.factor_conversion || !data.precio_venta) {
                            this.ui.showToast('Completa nombre, factor y precio', 'warning');
                            return false;
                        }
                        await this.inventarioService.actualizarPresentacion(pres.id, {
                            nombre: data.nombre.trim(),
                            factor_conversion: Math.round(Number(data.factor_conversion)),
                            precio_venta: Number(data.precio_venta),
                            codigo_barras: data.codigo_barras?.trim() || null
                        });
                        // Refrescar lista
                        this.presentaciones = await this.inventarioService.obtenerPresentaciones(this.producto!.id);
                        return true;
                    }
                }
            ]
        });
        await alert.present();
    }

    async eliminarPresentacion(pres: ProductoPresentacion) {
        const alert = await this.alertCtrl.create({
            header: 'Eliminar presentacion',
            message: `¿Eliminar "${pres.nombre}"? Las ventas anteriores conservaran su historial.`,
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Eliminar',
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

    get unidadMedidaLabel(): string {
        const um = this.productoForm?.get('unidad_medida')?.value;
        const labels: Record<string, string> = { kg: 'Kilogramo', lb: 'Libra', g: 'Gramo', ml: 'Mililitro', L: 'Litro' };
        return labels[um] || um;
    }

    esCampoInvalido(campo: string): boolean {
        const control = this.productoForm.get(campo);
        return !!(control && control.invalid && (control.dirty || control.touched));
    }

    private playBeep() {
        try {
            if (!this.audioCtx || this.audioCtx.state === 'closed') {
                this.audioCtx = new AudioContext();
            }
            const oscillator = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            oscillator.type = 'square';
            oscillator.frequency.value = 1000;
            gain.gain.value = 1.0;
            oscillator.connect(gain);
            gain.connect(this.audioCtx.destination);
            oscillator.start();
            oscillator.stop(this.audioCtx.currentTime + 0.12);
        } catch { /* silencioso si falla */ }
    }

    ngOnDestroy() {
        if (this.escaneando) this.cerrarEscaner();
        this.audioCtx?.close().catch(() => {});
    }
}
