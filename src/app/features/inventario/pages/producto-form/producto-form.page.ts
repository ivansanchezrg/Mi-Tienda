import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { IonicModule, AlertController, NavController, ViewWillEnter } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { addIcons } from 'ionicons';
import { arrowBackOutline, barcodeOutline, saveOutline, documentTextOutline, alertCircleOutline, cameraOutline, closeCircle, closeOutline, imagesOutline, informationCircleOutline, trashOutline, chevronDownOutline, chevronUpOutline, layersOutline, checkmarkCircleOutline, searchOutline, cubeOutline, scaleOutline, addOutline, refreshOutline, warningOutline, trendingUpOutline, trendingDownOutline, removeOutline, sparklesOutline, colorPaletteOutline } from 'ionicons/icons';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { BarcodeScannerService } from '../../../../core/services/barcode-scanner.service';

import { Producto, ProductoPresentacion, TipoVenta, GrupoVariante } from '../../models/producto.model';

interface PresentacionForm {
    nombre: string;
    factor_conversion: number;
    precio_venta: number;
    precio_costo: number;
    codigo_barras?: string;
}
import { CategoriaProducto } from '../../models/categoria-producto.model';
import { InventarioService } from '../../services/inventario.service';

import { NumbersOnlyDirective } from '../../../../shared/directives/numbers-only.directive';
import { CurrencyInputDirective } from '../../../../shared/directives/currency-input.directive';
import { UppercaseInputDirective } from '../../../../shared/directives/uppercase-input.directive';
import { CurrencyService } from '../../../../core/services/currency.service';
import { calcularPrecioDesdeMargen, calcularMargenDesdePrecio } from '../../../../core/utils/margen.util';
import { UiService } from '../../../../core/services/ui.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { StorageService } from '../../../../core/services/storage.service';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';
import { PresentacionModalComponent, PresentacionModalResult } from '../../components/presentacion-modal/presentacion-modal.component';
import { ModalController } from '@ionic/angular';

@Component({
    selector: 'app-producto-form',
    templateUrl: './producto-form.page.html',
    styleUrls: ['./producto-form.page.scss'],
    standalone: true,
    imports: [IonicModule, CommonModule, ReactiveFormsModule, FormsModule, NumbersOnlyDirective, CurrencyInputDirective, UppercaseInputDirective]
})
export class ProductoFormPage implements OnInit, OnDestroy, ViewWillEnter {
    private inicializado = false;
    private navCtrl = inject(NavController);
    private route = inject(ActivatedRoute);
    private fb = inject(FormBuilder);
    private inventarioService = inject(InventarioService);
    public currencyService = inject(CurrencyService);
    private ui = inject(UiService);
    private storageService = inject(StorageService);
    private alertCtrl = inject(AlertController);
    private modalCtrl = inject(ModalController);
    private logger = inject(LoggerService);
    private barcodeScanner = inject(BarcodeScannerService);

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
    // Presentaciones en modo CREAR (en memoria, aún sin producto_id)
    presentacionesNuevas: PresentacionForm[] = [];
    // Nombre de la presentación recién agregada para disparar animación
    presentacionRecienAgregada: string | null = null;

    // Variantes
    grupoVarianteSeleccionado: GrupoVariante | null = null;
    variantesHermanas: Producto[] = [];
    gruposSugeridos: GrupoVariante[] = [];
    buscandoGrupos = false;
    textoGrupo = '';
    private grupoSearch$ = new Subject<string>();
    private grupoSearchSub!: Subscription;

    // Imagen del producto
    fotoPreview: string | null = null;       // DataURL para preview local
    imagenUrlExistente: string | null = null; // URL pública si ya tenía imagen
    private imagenPathAnterior: string | null = null; // Path en storage para eliminar si se cambia
    private fotoNueva = false;               // true si el usuario seleccionó/cambió foto
    private fotoEliminada = false;           // true si el usuario quitó la foto existente

    constructor() {
        addIcons({ arrowBackOutline, barcodeOutline, saveOutline, documentTextOutline, alertCircleOutline, cameraOutline, closeCircle, closeOutline, imagesOutline, informationCircleOutline, trashOutline, chevronDownOutline, chevronUpOutline, layersOutline, checkmarkCircleOutline, searchOutline, cubeOutline, scaleOutline, addOutline, refreshOutline, warningOutline, trendingUpOutline, trendingDownOutline, removeOutline, sparklesOutline, colorPaletteOutline });
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
            // Cargar presentaciones activas e inactivas del producto
            [this.presentaciones, this.presentacionesInactivas] = await Promise.all([
                this.inventarioService.obtenerPresentaciones(producto.id),
                this.inventarioService.obtenerPresentacionesInactivas(producto.id)
            ]);

            // Si tiene grupo de variantes, cargar hermanas
            if (producto.grupo_variante) {
                this.grupoVarianteSeleccionado = producto.grupo_variante;
                this.variantesHermanas = await this.inventarioService.obtenerVariantesDelGrupo(
                    producto.grupo_variante.id, producto.id
                );
            }
        }
        this.cargando = false;
        this.inicializado = true;

        this.initForm();

        this.grupoSearchSub = this.grupoSearch$
            .pipe(debounceTime(300), distinctUntilChanged())
            .subscribe(texto => this.ejecutarBusquedaGrupos(texto));
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
            unidad_medida: [this.producto?.unidad_medida || 'und'],
            grupo_variante_id: [this.producto?.grupo_variante_id || null]
        });

        // En modo CREAR, marcar categoría como touched para que se vea el error de inmediato
        if (this.modo === 'CREAR') {
            this.productoForm.get('categoria_id')?.markAsTouched();
        }

        // En modo EDITAR: calcular margenPct inicial desde los valores cargados
        if (this.producto?.precio_costo && this.producto?.precio_venta) {
            this.margenPct = calcularMargenDesdePrecio(this.producto.precio_costo, this.producto.precio_venta);
            this.margenAbsoluto = this.producto.precio_venta - this.producto.precio_costo;
        }
    }

    get costoActual(): number {
        const raw = this.currencyService.parse(this.productoForm?.get('precio_costo')?.value ?? 0);
        return Math.round(raw * 100) / 100;
    }

    get margenColor(): string {
        return 'success';
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
            unidad_medida: isPeso ? value.unidad_medida : 'und',
            grupo_variante_id: value.grupo_variante_id || null
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
                const productoCreado = await this.inventarioService.crearProducto(productoPayload);
                if (productoCreado.id && this.presentacionesNuevas.length > 0) {
                    const presentaciones = await Promise.all(
                        this.presentacionesNuevas.map(p =>
                            this.inventarioService.crearPresentacion({ ...p, producto_id: productoCreado.id }, true)
                        )
                    );
                    // Emitir ACTUALIZADO con las presentaciones ya incluidas
                    // para que la lista de inventario reemplace el item sin presentaciones
                    this.inventarioService.emitirCambio({
                        tipo: 'ACTUALIZADO',
                        producto: { ...productoCreado, presentaciones }
                    });
                }
            } else {
                await this.inventarioService.actualizarProducto(this.producto!.id, productoPayload);
                this.productoForm.markAsPristine();
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
            header: `¿Quitar "${this.producto.nombre}"?`,
            message: 'Dejará de aparecer en el inventario y el POS. Puedes reactivarlo cuando quieras desde la lista de productos.',
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Quitar',
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

    async reactivarProducto() {
        if (!this.producto) return;
        const alert = await this.alertCtrl.create({
            header: 'Reactivar producto',
            message: `"${this.producto.nombre}" volverá a aparecer en el inventario y el POS.`,
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
        this.ui.showToast(`Código capturado: ${codigo}`, 'success');
    }

    async cerrarEscaner() {
        await this.barcodeScanner.stop();
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
        this.presentacionesNuevas = [...this.presentacionesNuevas, result];
        this.animarPresentacion(result.nombre);
    }

    async editarPresentacionNueva(index: number) {
        const pres = this.presentacionesNuevas[index];
        const nombresOtros = this.presentacionesNuevas.filter((_, i) => i !== index).map(p => p.nombre);
        const result = await this.abrirPresentacionModal(nombresOtros, pres);
        if (!result) return;
        this.presentacionesNuevas = this.presentacionesNuevas.map((p, i) => i === index ? result : p);
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
                const creada = await this.inventarioService.crearPresentacion({
                    producto_id: this.producto!.id,
                    ...result
                });
                if (creada?.id) {
                    this.presentaciones = [...this.presentaciones, creada];
                    this.animarPresentacion(creada.nombre);
                    this.ui.showToast(`Presentación "${creada.nombre}" guardada`, 'success');
                    return true;
                }
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
                await this.inventarioService.actualizarPresentacion(pres.id, result);
                this.presentaciones = await this.inventarioService.obtenerPresentaciones(this.producto!.id);
                this.ui.showToast(`Presentación "${result.nombre}" actualizada`, 'success');
                return true;
            }
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
            header: `¿Quitar "${pres.nombre}"?`,
            message: 'Dejará de aparecer en el POS. Las ventas realizadas con esta presentación no se verán afectadas.',
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

    private async abrirPresentacionModal(
        nombresExistentes: string[],
        presentacionActual?: PresentacionModalResult,
        onConfirmar?: (result: PresentacionModalResult) => Promise<boolean>
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
                onConfirmar
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

    // ==========================================
    // VARIANTES — grupo de variantes
    // ==========================================

    buscarGrupos(texto: string) {
        this.textoGrupo = texto;
        if (!texto || texto.length < 2) {
            this.gruposSugeridos = [];
            this.buscandoGrupos = false;
            return;
        }
        this.buscandoGrupos = true;
        this.grupoSearch$.next(texto);
    }

    private async ejecutarBusquedaGrupos(texto: string) {
        this.gruposSugeridos = await this.inventarioService.buscarGruposVariantes(texto);
        this.buscandoGrupos = false;
    }

    async seleccionarGrupo(grupo: GrupoVariante) {
        this.grupoVarianteSeleccionado = grupo;
        this.productoForm.patchValue({ grupo_variante_id: grupo.id });
        this.productoForm.markAsDirty();
        this.gruposSugeridos = [];
        this.textoGrupo = '';
        this.variantesHermanas = await this.inventarioService.obtenerVariantesDelGrupo(
            grupo.id, this.producto?.id
        );
    }

    async crearOSeleccionarGrupo(nombre: string) {
        if (!nombre || nombre.trim().length < 2) return;
        const grupo = await this.inventarioService.crearOObtenerGrupoVariante(nombre);
        if (grupo) await this.seleccionarGrupo(grupo);
    }

    quitarDelGrupo() {
        this.grupoVarianteSeleccionado = null;
        this.variantesHermanas = [];
        this.gruposSugeridos = [];
        this.textoGrupo = '';
        this.productoForm.patchValue({ grupo_variante_id: null });
        this.productoForm.markAsDirty();
    }

    get grupoNoCoincideExacto(): boolean {
        if (!this.textoGrupo || this.textoGrupo.trim().length < 2) return false;
        const textoNorm = this.textoGrupo.toUpperCase().trim();
        return !this.gruposSugeridos.some(g => g.nombre === textoNorm);
    }

    esCampoInvalido(campo: string): boolean {
        const control = this.productoForm.get(campo);
        return !!(control && control.invalid && (control.dirty || control.touched));
    }

    ngOnDestroy() {
        if (this.escaneando) this.cerrarEscaner();
        this.grupoSearchSub?.unsubscribe();
    }
}
