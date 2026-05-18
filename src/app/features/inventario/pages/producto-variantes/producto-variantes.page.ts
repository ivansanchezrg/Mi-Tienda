import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SafeUrl } from '@angular/platform-browser';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import {
    NavController, ModalController, AlertController,
    IonHeader, IonToolbar, IonButtons, IonButton, IonTitle, IonContent, IonFooter, IonIcon,
    IonInput, IonItem, IonCard, IonCardContent, IonSpinner, IonToggle
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    arrowBackOutline, colorPaletteOutline, addOutline, closeOutline,
    checkmarkCircleOutline, checkmarkOutline, chevronForwardOutline, sparklesOutline,
    pricetagOutline, cubeOutline, createOutline, trashOutline,
    informationCircleOutline, trendingUpOutline, warningOutline, barcodeOutline,
    cameraOutline, imageOutline, closeCircle
} from 'ionicons/icons';
import { CameraSource } from '@capacitor/camera';
import { calcularPrecioDesdeMargen, calcularMargenDesdePrecio } from '../../../../core/utils/margen.util';

import { InventarioService } from '../../services/inventario.service';
import { Atributo, AtributoOpcion } from '../../models/producto.model';
import { BarcodeScannerService } from '../../../../core/services/barcode-scanner.service';
import { StorageService } from '../../../../core/services/storage.service';
import { CategoriaProducto } from '../../models/categoria-producto.model';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { NumbersOnlyDirective } from '../../../../shared/directives/numbers-only.directive';
import { CurrencyInputDirective } from '../../../../shared/directives/currency-input.directive';
import { UppercaseInputDirective } from '../../../../shared/directives/uppercase-input.directive';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';
import { ScannerOverlayComponent } from '../../../../shared/components/scanner-overlay/scanner-overlay.component';
import { ROUTES } from '../../../../core/config/routes.config';

interface AtributoEditor {
    atributo: Atributo;
    opciones: AtributoOpcion[];
}

interface SKUGenerado {
    nombre: string;
    precio_costo: number;
    precio_venta: number;
    stock_actual: number;
    stock_minimo: number;
    opcion_ids: string[];
    seleccionado: boolean;
    labels: string[];
    margen: number;
    codigo_barras: string;
    imagenRawUrl?: string;
    imagenPreviewUrl?: string;
}

@Component({
    selector: 'app-producto-variantes',
    templateUrl: './producto-variantes.page.html',
    styleUrls: ['./producto-variantes.page.scss'],
    standalone: true,
    imports: [
        CommonModule, ReactiveFormsModule, FormsModule,
        IonHeader, IonToolbar, IonButtons, IonButton, IonTitle, IonContent, IonFooter, IonIcon,
        IonInput, IonItem, IonCard, IonCardContent, IonSpinner, IonToggle,
        NumbersOnlyDirective, CurrencyInputDirective, UppercaseInputDirective, ScannerOverlayComponent,
    ]
})
export class ProductoVariantesPage implements OnInit {
    private navCtrl = inject(NavController);
    private fb = inject(FormBuilder);
    private inventarioService = inject(InventarioService);
    protected currencyService = inject(CurrencyService);
    private ui = inject(UiService);
    private logger = inject(LoggerService);
    private modalCtrl = inject(ModalController);
    private alertCtrl = inject(AlertController);
    protected barcodeScanner = inject(BarcodeScannerService);
    protected storageService = inject(StorageService);

    paso = 1;
    guardando = false;
    escaneando = false;
    categorias: CategoriaProducto[] = [];

    // Imagen del template
    templateFotoPreviewUrl: SafeUrl | null = null;
    templateFotoRawUrl: string | null = null;

    // ── Margen de ganancia ──
    margenPct: number = 20;
    margenAbsoluto = 0;

    // ── Paso 1: datos base ──
    templateForm!: FormGroup;

    // ── Paso 2: atributos ──
    atributosEditor: AtributoEditor[] = [];
    textoNuevoTipo = '';
    atributosSugeridos: Atributo[] = [];
    buscandoTipo = false;
    mostrarInputTipo = false;
    private tipoDebounce: ReturnType<typeof setTimeout> | undefined;
    tipoEnEdicion: string | null = null;
    textoNuevaOpcion = '';
    opcionesSugeridas: AtributoOpcion[] = [];
    buscandoOpcion = false;
    private opcionDebounce: ReturnType<typeof setTimeout> | undefined;

    // ── Paso 3: SKUs generados ──
    skusGenerados: SKUGenerado[] = [];

    constructor() {
        addIcons({
            arrowBackOutline, colorPaletteOutline, addOutline, closeOutline,
            checkmarkCircleOutline, checkmarkOutline, chevronForwardOutline, sparklesOutline,
            pricetagOutline, cubeOutline, createOutline, trashOutline,
            informationCircleOutline, trendingUpOutline, warningOutline, barcodeOutline,
            cameraOutline, imageOutline, closeCircle
        });
        this.initForm();
    }

    async ngOnInit() {
        this.categorias = await this.inventarioService.obtenerCategorias();
    }

    private initForm() {
        this.templateForm = this.fb.group({
            nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
            categoria_id: [null, Validators.required],
            tiene_iva: [true],
            tipo_venta: ['UNIDAD'],
            precio_costo_base: ['', [Validators.required, Validators.min(0.01)]],
            precio_venta_base: ['', [Validators.required, Validators.min(0.01)]],
            stock_minimo: [5, [Validators.required, Validators.min(0)]]
        });
    }

    get costoActual(): number {
        const raw = this.currencyService.parse(this.templateForm?.get('precio_costo_base')?.value ?? 0);
        return Math.round(raw * 100) / 100;
    }

    onCostoChange() {
        setTimeout(() => {
            const costo = this.costoActual;
            if (costo <= 0) {
                this.templateForm.get('precio_venta_base')?.setValue('', { emitEvent: false });
                this.margenPct = 20;
                this.margenAbsoluto = 0;
                return;
            }
            this.recalcularPrecioDesdeMargen();
        });
    }

    onPrecioVentaChange() {
        setTimeout(() => {
            const costo = this.costoActual;
            const ventaRaw = this.currencyService.parse(this.templateForm?.get('precio_venta_base')?.value ?? 0);
            const venta = Math.round(ventaRaw * 100) / 100;
            this.margenPct = calcularMargenDesdePrecio(costo, venta);
            this.margenAbsoluto = venta > costo ? Math.round((venta - costo) * 100) / 100 : 0;
        });
    }

    private recalcularPrecioDesdeMargen() {
        const costo = this.costoActual;
        if (costo <= 0 || this.margenPct <= 0) return;
        const precio = calcularPrecioDesdeMargen(costo, this.margenPct);
        const precioRedondeado = Math.round(precio * 100) / 100;
        this.templateForm.get('precio_venta_base')?.setValue(
            this.currencyService.format(precioRedondeado),
            { emitEvent: false }
        );
        // No tocar margenPct — conservar el margen objetivo que fijó el usuario
        this.margenAbsoluto = Math.round((precioRedondeado - costo) * 100) / 100;
    }

    get categoriaLabel(): string {
        const id = this.templateForm?.get('categoria_id')?.value;
        if (!id) return 'Seleccionar categoria *';
        return this.categorias.find(c => c.id === id)?.nombre || 'Seleccionar categoria *';
    }

    esCampoInvalido(campo: string): boolean {
        const c = this.templateForm.get(campo);
        return !!(c && c.invalid && (c.dirty || c.touched));
    }

    volver() {
        if (this.paso > 1) {
            this.paso--;
        } else {
            this.navCtrl.navigateBack(ROUTES.inventario.nuevo);
        }
    }

    navegarAPaso(paso: number) {
        if (paso >= this.paso) return; // solo permite ir hacia atrás
        this.tipoEnEdicion = null;
        this.paso = paso;
    }

    // ==========================================
    // PASO 1 → 2
    // ==========================================

    async abrirSelectorCategoria() {
        const groups: ModalOptionGroup[] = [{
            title: 'Categorias',
            options: this.categorias.map(c => ({ label: c.nombre, value: String(c.id) }))
        }];
        const current = this.templateForm.get('categoria_id')?.value;
        const modal = await this.modalCtrl.create({
            component: OptionsModalComponent,
            componentProps: { title: 'Categoria', groups, selectedValue: current ? String(current) : undefined },
            cssClass: 'options-modal',
            breakpoints: [0, 1],
            initialBreakpoint: 1
        });
        await modal.present();
        const { data } = await modal.onDidDismiss();
        this.templateForm.get('categoria_id')?.markAsTouched();
        if (data) this.templateForm.patchValue({ categoria_id: data });
    }

    async seleccionarFotoTemplate() {
        const buttons: any[] = [];
        if (this.storageService.isNative) {
            buttons.push({ text: 'Tomar foto', handler: () => this.tomarFotoTemplate(CameraSource.Camera) });
        }
        buttons.push({ text: 'Galeria', handler: () => this.tomarFotoTemplate(CameraSource.Photos) });
        buttons.push({ text: 'Cancelar', role: 'cancel' });
        const alert = await this.alertCtrl.create({ header: 'Imagen del producto', buttons });
        await alert.present();
    }

    private async tomarFotoTemplate(source: CameraSource) {
        const result = await this.storageService.capturarFoto(source);
        if (!result) return;
        this.templateFotoPreviewUrl = result.previewUrl;
        this.templateFotoRawUrl = result.rawUrl;
    }

    removerFotoTemplate() {
        this.templateFotoPreviewUrl = null;
        this.templateFotoRawUrl = null;
    }

    async seleccionarFotoSku(sku: SKUGenerado) {
        const source = this.storageService.isNative ? CameraSource.Camera : CameraSource.Photos;
        const result = await this.storageService.capturarFoto(source);
        if (!result) return;
        sku.imagenRawUrl = result.rawUrl;
        sku.imagenPreviewUrl = result.rawUrl;
    }

    removerFotoSku(sku: SKUGenerado) {
        sku.imagenRawUrl = undefined;
        sku.imagenPreviewUrl = undefined;
    }

    avanzarAlPaso2() {
        this.templateForm.markAllAsTouched();
        if (this.templateForm.invalid) return;
        this.paso = 2;
    }

    // ==========================================
    // PASO 2 — ATRIBUTOS
    // ==========================================

    onTipoInput(valor: string) {
        this.textoNuevoTipo = valor;
        clearTimeout(this.tipoDebounce);
        if (!valor || valor.trim().length < 2) {
            this.atributosSugeridos = [];
            this.buscandoTipo = false;
            return;
        }
        this.buscandoTipo = true;
        this.tipoDebounce = setTimeout(async () => {
            this.atributosSugeridos = await this.inventarioService.buscarAtributos(valor);
            this.buscandoTipo = false;
        }, 300);
    }

    get tipoNoCoincideExacto(): boolean {
        if (!this.textoNuevoTipo || this.textoNuevoTipo.trim().length < 2) return false;
        const norm = this.textoNuevoTipo.toUpperCase().trim();
        const yaEnEditor = this.atributosEditor.some(a => a.atributo.nombre === norm);
        const enSugerencias = this.atributosSugeridos.some(a => a.nombre === norm);
        return !yaEnEditor && !enSugerencias;
    }

    async agregarTipo(atributo: Atributo) {
        if (this.atributosEditor.some(a => a.atributo.id === atributo.id)) {
            this.ui.showToast(`"${atributo.nombre}" ya esta agregado`, 'warning');
            return;
        }
        const opcionesExistentes = await this.inventarioService.obtenerOpcionesAtributo(atributo.id);
        this.atributosEditor.push({ atributo, opciones: [] });
        this.textoNuevoTipo = '';
        this.atributosSugeridos = [];
        this.mostrarInputTipo = false;
        this.textoNuevaOpcion = '';
        this.tipoEnEdicion = atributo.id;
        // Cargar sugerencias inmediatamente para que el usuario vea opciones previas sin tener que escribir
        this.opcionesSugeridas = opcionesExistentes;
    }

    async crearYAgregarTipo(nombre: string) {
        if (!nombre || nombre.trim().length < 2) return;
        const atributo = await this.inventarioService.crearOObtenerAtributo(nombre);
        if (atributo) await this.agregarTipo(atributo);
    }

    toggleInputTipo() {
        this.mostrarInputTipo = !this.mostrarInputTipo;
        if (!this.mostrarInputTipo) {
            this.textoNuevoTipo = '';
            this.atributosSugeridos = [];
        }
    }

    quitarTipo(atributoId: string) {
        this.atributosEditor = this.atributosEditor.filter(a => a.atributo.id !== atributoId);
        if (this.tipoEnEdicion === atributoId) {
            this.tipoEnEdicion = null;
            this.textoNuevaOpcion = '';
        }
    }

    abrirEdicionOpciones(atributoId: string) {
        this.tipoEnEdicion = atributoId;
        this.textoNuevaOpcion = '';
        this.opcionesSugeridas = [];
        const editor = this.atributosEditor.find(a => a.atributo.id === atributoId);
        if (editor) {
            this.inventarioService.obtenerOpcionesAtributo(atributoId).then(ops => {
                this.opcionesSugeridas = ops.filter(
                    o => !editor.opciones.some(e => e.id === o.id)
                );
            });
        }
    }

    cerrarEdicionOpciones() {
        this.tipoEnEdicion = null;
        this.textoNuevaOpcion = '';
        this.opcionesSugeridas = [];
    }

    onOpcionInput(valor: string) {
        this.textoNuevaOpcion = valor;
        clearTimeout(this.opcionDebounce);
        if (!valor || valor.trim().length < 1) return;
        this.buscandoOpcion = true;
        const atributoId = this.tipoEnEdicion!;
        this.opcionDebounce = setTimeout(async () => {
            const sugeridas = await this.inventarioService.buscarOpcionesAtributo(atributoId, valor);
            const editor = this.atributosEditor.find(a => a.atributo.id === atributoId);
            this.opcionesSugeridas = sugeridas.filter(
                o => !editor?.opciones.some(e => e.id === o.id)
            );
            this.buscandoOpcion = false;
        }, 300);
    }

    get opcionNoCoincideExacto(): boolean {
        if (!this.textoNuevaOpcion || this.textoNuevaOpcion.trim().length < 1) return false;
        const norm = this.textoNuevaOpcion.toUpperCase().trim();
        const editor = this.atributosEditor.find(a => a.atributo.id === this.tipoEnEdicion);
        const yaEnEditor = editor?.opciones.some(o => o.valor === norm) ?? false;
        const enSugerencias = this.opcionesSugeridas.some(o => o.valor === norm);
        return !yaEnEditor && !enSugerencias;
    }

    async agregarOpcion(opcion: AtributoOpcion) {
        if (!this.tipoEnEdicion) return;
        const editor = this.atributosEditor.find(a => a.atributo.id === this.tipoEnEdicion);
        if (!editor) return;
        if (editor.opciones.some(o => o.id === opcion.id)) return;
        editor.opciones = [...editor.opciones, opcion];
        // Mantener el panel abierto para seguir agregando opciones
        this.textoNuevaOpcion = '';
        this.opcionesSugeridas = (await this.inventarioService.obtenerOpcionesAtributo(this.tipoEnEdicion))
            .filter(o => !editor.opciones.some(e => e.id === o.id));
    }

    async crearYAgregarOpcion(valor: string) {
        if (!this.tipoEnEdicion || !valor || valor.trim().length < 1) return;
        const opcion = await this.inventarioService.crearOObtenerOpcionAtributo(this.tipoEnEdicion, valor);
        if (opcion) {
            const editor = this.atributosEditor.find(a => a.atributo.id === this.tipoEnEdicion);
            if (!editor || editor.opciones.some(o => o.id === opcion.id)) return;
            editor.opciones = [...editor.opciones, opcion];
            this.textoNuevaOpcion = '';
            this.opcionesSugeridas = (await this.inventarioService.obtenerOpcionesAtributo(this.tipoEnEdicion!))
                .filter(o => !editor.opciones.some(e => e.id === o.id));
        }
    }

    quitarOpcion(atributoId: string, opcionId: string) {
        const editor = this.atributosEditor.find(a => a.atributo.id === atributoId);
        if (editor) {
            const opcionRemovida = editor.opciones.find(o => o.id === opcionId);
            editor.opciones = editor.opciones.filter(o => o.id !== opcionId);

            // Si el editor está abierto para este atributo, devolver la opción a sugerencias
            if (opcionRemovida && this.tipoEnEdicion === atributoId) {
                this.opcionesSugeridas = [...this.opcionesSugeridas, opcionRemovida]
                    .sort((a, b) => a.valor.localeCompare(b.valor));
            }
        }
    }

    get totalCombinaciones(): number {
        if (this.atributosEditor.length === 0) return 0;
        const conOpciones = this.atributosEditor.filter(a => a.opciones.length > 0);
        if (conOpciones.length === 0) return 0;
        return conOpciones.reduce((acc, a) => acc * a.opciones.length, 1);
    }

    get puedeAvanzarAlPaso3(): boolean {
        return this.atributosEditor.length > 0 &&
            this.atributosEditor.every(a => a.opciones.length > 0);
    }

    avanzarAlPaso3() {
        if (!this.puedeAvanzarAlPaso3) return;
        this.tipoEnEdicion = null;
        this.skusGenerados = this.generarCombinaciones();
        this.paso = 3;
    }

    private generarCombinaciones(): SKUGenerado[] {
        const nombreBase = this.templateForm.get('nombre')!.value.trim().toUpperCase();
        const precioCosto = Math.round(this.currencyService.parse(this.templateForm.get('precio_costo_base')!.value) * 100) / 100;
        const precioVenta = Math.round(this.currencyService.parse(this.templateForm.get('precio_venta_base')!.value) * 100) / 100;
        const stockMinimo = Number(this.templateForm.get('stock_minimo')!.value) || 5;

        const combinaciones = this.cartesian(this.atributosEditor.map(a => a.opciones));

        return combinaciones.map(combo => {
            const labels = combo.map(o => o.valor);
            return {
                nombre: `${nombreBase} ${labels.join(' ')}`,
                precio_costo: precioCosto,
                precio_venta: precioVenta,
                stock_actual: 0,
                stock_minimo: stockMinimo,
                opcion_ids: combo.map(o => o.id),
                seleccionado: true,
                labels,
                margen: this.margenPct,
                codigo_barras: ''
            };
        });
    }

    private cartesian(arrays: AtributoOpcion[][]): AtributoOpcion[][] {
        return arrays.reduce<AtributoOpcion[][]>(
            (acc, curr) => ([] as AtributoOpcion[][]).concat(
                ...acc.map(a => curr.map(b => [...a, b]))
            ),
            [[]]
        );
    }

    get nombreBase(): string {
        return this.templateForm.get('nombre')!.value.trim().toUpperCase();
    }

    toggleSKU(sku: SKUGenerado) {
        sku.seleccionado = !sku.seleccionado;
    }

    margenSku(sku: SKUGenerado): number {
        return sku.margen;
    }

    async escanearCodigoSku(sku: SKUGenerado) {
        this.escaneando = true;
        const codigo = await this.barcodeScanner.scan();
        this.escaneando = false;
        if (!codigo) return;
        sku.codigo_barras = codigo;
        this.ui.showToast(`Codigo capturado: ${codigo}`, 'success');
    }

    parsearPrecio(valor: string, sku: SKUGenerado, campo: 'costo' | 'venta'): void {
        const parsed = Math.round(this.currencyService.parse(valor) * 100) / 100;
        if (campo === 'costo') {
            sku.precio_costo = parsed;
        } else {
            sku.precio_venta = parsed;
        }
        sku.margen = calcularMargenDesdePrecio(sku.precio_costo, sku.precio_venta);
    }

    get skusSeleccionados(): SKUGenerado[] {
        return this.skusGenerados.filter(s => s.seleccionado);
    }

    // ==========================================
    // PASO 3 → GUARDAR (RPC atomica)
    // ==========================================

    async guardar() {
        const seleccionados = this.skusSeleccionados;
        if (seleccionados.length === 0) {
            this.ui.showToast('Selecciona al menos una variante', 'warning');
            return;
        }
        if (this.guardando) return;
        this.guardando = true;

        const subfolder = this.sanitizarSubfolder(
            this.categorias.find(c => c.id === this.templateForm.get('categoria_id')?.value)?.nombre || 'sin-categoria'
        );
        const uploadedPaths: string[] = [];

        try {
            const v = this.templateForm.value;

            // Subir imagen del template
            let templateImagenUrl: string | null = null;
            if (this.templateFotoRawUrl) {
                templateImagenUrl = await this.storageService.uploadImage(this.templateFotoRawUrl, `productos/${subfolder}`, false);
                if (!templateImagenUrl) { this.guardando = false; return; }
                uploadedPaths.push(templateImagenUrl);
            }

            // Subir imágenes de SKUs en paralelo
            const skuImagenUrls = await Promise.all(
                seleccionados.map(async sku => {
                    if (!sku.imagenRawUrl) return null;
                    const path = await this.storageService.uploadImage(sku.imagenRawUrl, `productos/${subfolder}`, false);
                    if (path) uploadedPaths.push(path);
                    return path;
                })
            );

            const resultado = await this.inventarioService.crearProductoConVariantes({
                nombre: v.nombre,
                categoria_id: v.categoria_id,
                tiene_iva: v.tiene_iva,
                tipo_venta: v.tipo_venta,
                unidad_medida: 'und',
                imagen_url: templateImagenUrl || undefined,
                atributos_template: this.atributosEditor.map(a => ({
                    atributo_nombre: a.atributo.nombre,
                    opcion_ids: a.opciones.map(o => o.id)
                })),
                variantes: seleccionados.map((sku, i) => ({
                    nombre: sku.nombre,
                    precio_costo: sku.precio_costo,
                    precio_venta: sku.precio_venta,
                    stock_actual: sku.stock_actual,
                    stock_minimo: sku.stock_minimo,
                    opcion_ids: sku.opcion_ids,
                    codigo_barras: sku.codigo_barras.trim() || null,
                    imagen_url: skuImagenUrls[i] || null
                }))
            });

            if (resultado.ok) {
                this.navCtrl.navigateBack(ROUTES.inventario.root);
            } else {
                // Rollback imágenes subidas si la RPC falló
                await Promise.all(uploadedPaths.map(p => this.storageService.deleteFile(p)));
            }
        } catch (error) {
            this.logger.error('ProductoVariantesPage', 'Error guardando variantes', error);
            await Promise.all(uploadedPaths.map(p => this.storageService.deleteFile(p)));
        } finally {
            this.guardando = false;
        }
    }

    private sanitizarSubfolder(nombre: string): string {
        return nombre
            .toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }
}
