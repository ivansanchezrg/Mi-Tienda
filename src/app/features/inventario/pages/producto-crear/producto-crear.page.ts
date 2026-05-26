import { Component, OnInit, inject } from '@angular/core';
import { ViewWillEnter } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { SafeUrl } from '@angular/platform-browser';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import {
    NavController, ModalController,
    IonHeader, IonToolbar, IonButtons, IonButton, IonTitle,
    IonContent, IonFooter, IonIcon, IonInput, IonItem,
    IonCard, IonCardContent, IonSpinner, IonToggle, IonSkeletonText
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
    arrowBackOutline, cubeOutline, colorPaletteOutline, checkmarkOutline,
    addOutline, closeOutline, checkmarkCircleOutline, chevronForwardOutline,
    chevronUpOutline, chevronDownOutline, layersOutline,
    sparklesOutline, pricetagOutline, createOutline, trashOutline,
    informationCircleOutline, trendingUpOutline, warningOutline, barcodeOutline,
    cameraOutline, imageOutline, closeCircle, saveOutline
} from 'ionicons/icons';
import { ActivatedRoute } from '@angular/router';
import { ROUTES } from '../../../../core/config/routes.config';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { StorageService } from '../../../../core/services/storage.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { BarcodeScannerService } from '../../../../core/services/barcode-scanner.service';
import { calcularMargenDesdePrecio, calcularPrecioDesdeMargen } from '../../../../core/utils/margen.util';
import { CategoriaProducto } from '../../models/categoria-producto.model';
import { Atributo, AtributoOpcion } from '../../models/producto.model';
import { InventarioService } from '../../services/inventario.service';
import { ProductoService } from '../../services/producto.service';
import { AtributoService } from '../../services/atributo.service';
import { NumbersOnlyDirective } from '../../../../shared/directives/numbers-only.directive';
import { CurrencyInputDirective } from '../../../../shared/directives/currency-input.directive';
import { UppercaseInputDirective } from '../../../../shared/directives/uppercase-input.directive';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';
import { ScannerOverlayComponent } from '../../../../shared/components/scanner-overlay/scanner-overlay.component';
import { ProductoInfoFormComponent, FotoSeleccionada } from '../../components/producto-info-form/producto-info-form.component';
import { ProductoPreciosFormComponent } from '../../components/producto-precios-form/producto-precios-form.component';
import { ProductoInventarioFormComponent } from '../../components/producto-inventario-form/producto-inventario-form.component';
import { ProductoPresentacionesComponent, PresentacionNueva } from '../../components/producto-presentaciones/producto-presentaciones.component';

type TipoProducto = 'simple' | 'variantes';

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
    presentaciones: PresentacionNueva[];
    mostrarPresentaciones: boolean;
}

@Component({
    selector: 'app-producto-crear',
    templateUrl: './producto-crear.page.html',
    styleUrls: ['./producto-crear.page.scss'],
    standalone: true,
    imports: [
        CommonModule, ReactiveFormsModule, FormsModule,
        IonHeader, IonToolbar, IonButtons, IonButton, IonTitle,
        IonContent, IonFooter, IonIcon, IonInput, IonItem,
        IonCard, IonCardContent, IonSpinner, IonToggle, IonSkeletonText,
        NumbersOnlyDirective, CurrencyInputDirective, UppercaseInputDirective,
        ScannerOverlayComponent,
        ProductoInfoFormComponent,
        ProductoPreciosFormComponent,
        ProductoInventarioFormComponent,
        ProductoPresentacionesComponent,
    ]
})
export class ProductoCrearPage implements OnInit, ViewWillEnter {
    private navCtrl         = inject(NavController);
    private route           = inject(ActivatedRoute);
    private fb              = inject(FormBuilder);
    private inventarioSvc   = inject(InventarioService);
    private productoSvc     = inject(ProductoService);
    private atributoSvc     = inject(AtributoService);
    private modalCtrl       = inject(ModalController);
    protected currencyService = inject(CurrencyService);
    private ui              = inject(UiService);
    protected storageService = inject(StorageService);
    private logger          = inject(LoggerService);
    protected barcodeScanner = inject(BarcodeScannerService);

    // ── Estado global ─────────────────────────────────────────────────────────
    guardando    = false;
    escaneando   = false;
    listo        = false;
    categorias: CategoriaProducto[] = [];

    // paso 1 = datos base + elección de tipo
    // simple:    paso 2 = precio/stock/presentaciones → guardar
    // variantes: paso 2 = atributos, paso 3 = SKUs → guardar
    paso         = 1;
    tipoProducto: TipoProducto = 'simple';

    // ── FLUJO SIMPLE ──────────────────────────────────────────────────────────
    simpleForm!: FormGroup;
    fotoPreviewUrl: SafeUrl | null = null;
    private fotoRawUrl: string | null = null;
    presentacionesNuevas: PresentacionNueva[] = [];

    // ── FLUJO VARIANTES (wizard multi-paso) ───────────────────────────────────
    templateForm!: FormGroup;
    templateFotoPreviewUrl: SafeUrl | null = null;
    templateFotoRawUrl: string | null = null;
    margenPct    = 20;
    margenAbsoluto = 0;

    atributosEditor: AtributoEditor[] = [];
    textoNuevoTipo  = '';
    atributosSugeridos: Atributo[] = [];
    buscandoTipo    = false;
    mostrarInputTipo = false;
    private tipoDebounce?: ReturnType<typeof setTimeout>;
    tipoEnEdicion: string | null = null;
    textoNuevaOpcion = '';
    opcionesSugeridas: AtributoOpcion[] = [];
    buscandoOpcion  = false;
    private opcionDebounce?: ReturnType<typeof setTimeout>;

    skusGenerados: SKUGenerado[] = [];

    constructor() {
        addIcons({
            arrowBackOutline, cubeOutline, colorPaletteOutline, checkmarkOutline,
            addOutline, closeOutline, checkmarkCircleOutline, chevronForwardOutline,
            chevronUpOutline, chevronDownOutline, layersOutline,
            sparklesOutline, pricetagOutline, createOutline, trashOutline,
            informationCircleOutline, trendingUpOutline, warningOutline, barcodeOutline,
            cameraOutline, imageOutline, closeCircle, saveOutline
        });
    }

    ngOnInit() {}

    async ionViewWillEnter() {
        const tipo   = this.route.snapshot.queryParamMap.get('tipo') as TipoProducto | null;
        const codigo = this.route.snapshot.queryParamMap.get('codigo') || undefined;

        // Resetear estado en cada entrada (Ionic cachea la instancia)
        this.listo           = false;
        this.paso            = 1;
        this.tipoProducto    = 'simple';
        this.guardando       = false;
        this.escaneando      = false;
        this.fotoPreviewUrl  = null;
        this.fotoRawUrl      = null;
        this.presentacionesNuevas = [];
        this.templateFotoPreviewUrl = null;
        this.templateFotoRawUrl     = null;
        this.margenPct       = 20;
        this.margenAbsoluto  = 0;
        this.atributosEditor = [];
        this.skusGenerados   = [];
        this.tipoEnEdicion   = null;
        this.textoNuevoTipo  = '';
        this.textoNuevaOpcion = '';
        this.atributosSugeridos = [];
        this.opcionesSugeridas  = [];
        this.mostrarInputTipo   = false;

        // Inicializar forms ANTES del await
        this._initSimpleForm(codigo);
        this._initTemplateForm();

        this.categorias = await this.inventarioSvc.obtenerCategorias();

        if (tipo === 'variantes') this.tipoProducto = 'variantes';
        if (tipo === 'simple' && codigo) this.paso = 2;

        this.listo = true;
    }

    private _initSimpleForm(codigoInicial?: string) {
        this.simpleForm = this.fb.group({
            codigo_barras: [codigoInicial || ''],
            nombre:        ['', [Validators.required, Validators.minLength(3), Validators.maxLength(100)]],
            categoria_id:  [null, Validators.required],
            precio_costo:  ['', [Validators.required, Validators.min(0.01)]],
            precio_venta:  ['', [Validators.required, Validators.min(0.01)]],
            stock_actual:  ['', [Validators.required, Validators.min(0)]],
            stock_minimo:  [5,  [Validators.required, Validators.min(0)]],
            tiene_iva:     [true],
            tipo_venta:    ['UNIDAD'],
            unidad_medida: ['und'],
        });
    }

    private _initTemplateForm() {
        this.templateForm = this.fb.group({
            nombre:            ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
            categoria_id:      [null, Validators.required],
            tiene_iva:         [true],
            tipo_venta:        ['UNIDAD'],
            precio_costo_base: ['', [Validators.required, Validators.min(0.01)]],
            precio_venta_base: ['', [Validators.required, Validators.min(0.01)]],
            stock_minimo:      [5,  [Validators.required, Validators.min(0)]],
        });
    }

    volver() {
        if (this.paso > 1) {
            this.paso--;
            return;
        }
        this.navCtrl.navigateBack(ROUTES.inventario.root);
    }

    get tituloHeader(): string {
        if (this.paso === 1) return 'Nuevo Producto';
        if (this.tipoProducto === 'simple') return 'Nuevo Producto';
        const pasoWizard = this.paso - 1; // paso 2 → "1 de 2", paso 3 → "2 de 2"
        return `Con Variantes — Paso ${pasoWizard} de 2`;
    }

    avanzarDesdeDatosBase() {
        this.simpleForm.get('nombre')?.markAsTouched();
        this.simpleForm.get('categoria_id')?.markAsTouched();
        if (this.simpleForm.get('nombre')?.invalid || this.simpleForm.get('categoria_id')?.invalid) return;

        if (this.tipoProducto === 'variantes') {
            // Sincronizar nombre y categoría al templateForm
            this.templateForm.patchValue({
                nombre:      this.simpleForm.get('nombre')?.value,
                categoria_id: this.simpleForm.get('categoria_id')?.value,
                tiene_iva:   this.simpleForm.get('tiene_iva')?.value,
            });
        }
        this.paso = 2;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FLUJO SIMPLE
    // ══════════════════════════════════════════════════════════════════════════

    onFotoSeleccionada(event: FotoSeleccionada) {
        this.fotoPreviewUrl = event.previewUrl;
        this.fotoRawUrl     = event.rawUrl;
    }

    onFotoRemovida() {
        this.fotoPreviewUrl = null;
        this.fotoRawUrl     = null;
    }

    async guardarSimple() {
        this.simpleForm.markAllAsTouched();
        if (this.simpleForm.invalid || this.guardando) return;
        this.guardando = true;

        const v = this.simpleForm.value;
        const subfolder = this._subfolder(this._nombreCategoria(v.categoria_id));

        try {
            let imagenUrl: string | undefined;
            if (this.fotoRawUrl) {
                const path = await this.storageService.uploadImage(this.fotoRawUrl, subfolder, false);
                if (!path) { this.guardando = false; return; }
                imagenUrl = path;
            }

            // Subir imágenes pendientes de presentaciones
            const presentacionesConImagen = await Promise.all(
                this.presentacionesNuevas.map(async p => {
                    let imagen_url = p.imagen_url ?? undefined;
                    if (imagen_url?.startsWith('__pending__')) {
                        const rawUrl = imagen_url.slice('__pending__'.length);
                        const path = await this.storageService.uploadImage(rawUrl, subfolder, false);
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

            const resultado = await this.productoSvc.crearSimple({
                nombre:        v.nombre,
                categoria_id:  v.categoria_id,
                tiene_iva:     v.tiene_iva,
                tipo_venta:    v.tipo_venta,
                unidad_medida: v.tipo_venta === 'PESO' ? v.unidad_medida : 'und',
                codigo_barras: v.codigo_barras?.trim() || undefined,
                imagen_url:    imagenUrl,
                precio_costo:  this.currencyService.parse(v.precio_costo),
                precio_venta:  this.currencyService.parse(v.precio_venta),
                stock_actual:  Number(v.stock_actual) || 0,
                stock_minimo:  Number(v.stock_minimo) || 0,
                presentaciones: presentacionesConImagen
            });

            if (resultado.ok) {
                this.navCtrl.navigateBack(ROUTES.inventario.root);
            } else if (imagenUrl) {
                await this.storageService.deleteFile(imagenUrl);
            }
        } catch (error) {
            this.logger.error('ProductoCrearPage', 'Error guardando producto simple', error);
        } finally {
            this.guardando = false;
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FLUJO VARIANTES — Paso 1
    // ══════════════════════════════════════════════════════════════════════════

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
            this._recalcularPrecioDesdeMargen();
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

    private _recalcularPrecioDesdeMargen() {
        const costo = this.costoActual;
        if (costo <= 0 || this.margenPct <= 0) return;
        const precio = calcularPrecioDesdeMargen(costo, this.margenPct);
        const redondeado = Math.round(precio * 100) / 100;
        this.templateForm.get('precio_venta_base')?.setValue(
            this.currencyService.format(redondeado), { emitEvent: false }
        );
        this.margenAbsoluto = Math.round((redondeado - costo) * 100) / 100;
    }

    get categoriaLabelTemplate(): string {
        const id = this.templateForm?.get('categoria_id')?.value;
        if (!id) return 'Seleccionar categoria *';
        return this.categorias.find(c => c.id === id)?.nombre || 'Seleccionar categoria *';
    }

    esCampoInvalidoTemplate(campo: string): boolean {
        const c = this.templateForm.get(campo);
        return !!(c && c.invalid && (c.dirty || c.touched));
    }

    async abrirSelectorCategoriaTemplate() {
        const groups: ModalOptionGroup[] = [{ title: 'Categorias', options: this.categorias.map(c => ({ label: c.nombre, value: String(c.id) })) }];
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
        const source = this.storageService.isNative
            ? (await import('@capacitor/camera')).CameraSource.Camera
            : (await import('@capacitor/camera')).CameraSource.Photos;
        const result = await this.storageService.capturarFoto(source);
        if (!result) return;
        this.templateFotoPreviewUrl = result.previewUrl;
        this.templateFotoRawUrl     = result.rawUrl;
    }

    removerFotoTemplate() {
        this.templateFotoPreviewUrl = null;
        this.templateFotoRawUrl     = null;
    }

    navegarAPaso(paso: number) {
        if (paso >= this.paso) return;
        this.tipoEnEdicion = null;
        this.paso = paso;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FLUJO VARIANTES — Paso 2 (Atributos)
    // ══════════════════════════════════════════════════════════════════════════

    onTipoInput(valor: string) {
        this.textoNuevoTipo = valor;
        clearTimeout(this.tipoDebounce);
        if (!valor || valor.trim().length < 2) { this.atributosSugeridos = []; this.buscandoTipo = false; return; }
        this.buscandoTipo = true;
        this.tipoDebounce = setTimeout(async () => {
            this.atributosSugeridos = await this.atributoSvc.buscarAtributos(valor);
            this.buscandoTipo = false;
        }, 300);
    }

    get tipoNoCoincideExacto(): boolean {
        if (!this.textoNuevoTipo || this.textoNuevoTipo.trim().length < 2) return false;
        const norm = this.textoNuevoTipo.toUpperCase().trim();
        return !this.atributosEditor.some(a => a.atributo.nombre === norm) &&
               !this.atributosSugeridos.some(a => a.nombre === norm);
    }

    async agregarTipo(atributo: Atributo) {
        if (this.atributosEditor.some(a => a.atributo.id === atributo.id)) {
            this.ui.showToast(`"${atributo.nombre}" ya esta agregado`, 'warning');
            return;
        }
        const opcionesExistentes = await this.atributoSvc.obtenerOpcionesAtributo(atributo.id);
        this.atributosEditor.push({ atributo, opciones: [] });
        this.textoNuevoTipo = ''; this.atributosSugeridos = []; this.mostrarInputTipo = false;
        this.tipoEnEdicion  = atributo.id;
        this.opcionesSugeridas = opcionesExistentes;
    }

    async crearYAgregarTipo(nombre: string) {
        if (!nombre || nombre.trim().length < 2) return;
        const atributo = await this.atributoSvc.crearOObtenerAtributo(nombre);
        if (atributo) await this.agregarTipo(atributo);
    }

    toggleInputTipo() {
        this.mostrarInputTipo = !this.mostrarInputTipo;
        if (!this.mostrarInputTipo) { this.textoNuevoTipo = ''; this.atributosSugeridos = []; }
    }

    quitarTipo(atributoId: string) {
        this.atributosEditor = this.atributosEditor.filter(a => a.atributo.id !== atributoId);
        if (this.tipoEnEdicion === atributoId) { this.tipoEnEdicion = null; this.textoNuevaOpcion = ''; }
    }

    abrirEdicionOpciones(atributoId: string) {
        this.tipoEnEdicion = atributoId;
        this.textoNuevaOpcion = '';
        const editor = this.atributosEditor.find(a => a.atributo.id === atributoId);
        if (editor) {
            this.atributoSvc.obtenerOpcionesAtributo(atributoId).then(ops => {
                this.opcionesSugeridas = ops.filter(o => !editor.opciones.some(e => e.id === o.id));
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
            const sugeridas = await this.atributoSvc.buscarOpcionesAtributo(atributoId, valor);
            const editor = this.atributosEditor.find(a => a.atributo.id === atributoId);
            this.opcionesSugeridas = sugeridas.filter(o => !editor?.opciones.some(e => e.id === o.id));
            this.buscandoOpcion = false;
        }, 300);
    }

    get opcionNoCoincideExacto(): boolean {
        if (!this.textoNuevaOpcion || this.textoNuevaOpcion.trim().length < 1) return false;
        const norm = this.textoNuevaOpcion.toUpperCase().trim();
        const editor = this.atributosEditor.find(a => a.atributo.id === this.tipoEnEdicion);
        return !(editor?.opciones.some(o => o.valor === norm)) && !this.opcionesSugeridas.some(o => o.valor === norm);
    }

    async agregarOpcion(opcion: AtributoOpcion) {
        if (!this.tipoEnEdicion) return;
        const editor = this.atributosEditor.find(a => a.atributo.id === this.tipoEnEdicion);
        if (!editor || editor.opciones.some(o => o.id === opcion.id)) return;
        editor.opciones = [...editor.opciones, opcion];
        this.textoNuevaOpcion = '';
        this.opcionesSugeridas = (await this.atributoSvc.obtenerOpcionesAtributo(this.tipoEnEdicion))
            .filter(o => !editor.opciones.some(e => e.id === o.id));
    }

    async crearYAgregarOpcion(valor: string) {
        if (!this.tipoEnEdicion || !valor || valor.trim().length < 1) return;
        const opcion = await this.atributoSvc.crearOObtenerOpcionAtributo(this.tipoEnEdicion, valor);
        if (opcion) {
            const editor = this.atributosEditor.find(a => a.atributo.id === this.tipoEnEdicion);
            if (!editor || editor.opciones.some(o => o.id === opcion.id)) return;
            editor.opciones = [...editor.opciones, opcion];
            this.textoNuevaOpcion = '';
            this.opcionesSugeridas = (await this.atributoSvc.obtenerOpcionesAtributo(this.tipoEnEdicion!))
                .filter(o => !editor.opciones.some(e => e.id === o.id));
        }
    }

    quitarOpcion(atributoId: string, opcionId: string) {
        const editor = this.atributosEditor.find(a => a.atributo.id === atributoId);
        if (!editor) return;
        const removida = editor.opciones.find(o => o.id === opcionId);
        editor.opciones = editor.opciones.filter(o => o.id !== opcionId);
        if (removida && this.tipoEnEdicion === atributoId) {
            this.opcionesSugeridas = [...this.opcionesSugeridas, removida].sort((a, b) => a.valor.localeCompare(b.valor));
        }
    }

    get totalCombinaciones(): number {
        const conOpciones = this.atributosEditor.filter(a => a.opciones.length > 0);
        if (conOpciones.length === 0) return 0;
        return conOpciones.reduce((acc, a) => acc * a.opciones.length, 1);
    }

    get puedeAvanzarAlPaso3(): boolean {
        return this.atributosEditor.length > 0 && this.atributosEditor.every(a => a.opciones.length > 0);
    }

    avanzarAlPaso3() {
        if (!this.puedeAvanzarAlPaso3) return;
        this.tipoEnEdicion = null;
        this.skusGenerados = this._generarCombinaciones();
        this.paso = 3;
    }

    private _generarCombinaciones(): SKUGenerado[] {
        const nombreBase  = this.templateForm.get('nombre')!.value.trim().toUpperCase();
        const precioCosto = Math.round(this.currencyService.parse(this.templateForm.get('precio_costo_base')!.value) * 100) / 100;
        const precioVenta = Math.round(this.currencyService.parse(this.templateForm.get('precio_venta_base')!.value) * 100) / 100;
        const stockMinimo = Number(this.templateForm.get('stock_minimo')!.value) || 5;
        const combinaciones = this._cartesian(this.atributosEditor.map(a => a.opciones));
        return combinaciones.map(combo => {
            const labels = combo.map(o => o.valor);
            return {
                nombre: `${nombreBase} ${labels.join(' ')}`,
                precio_costo: precioCosto, precio_venta: precioVenta,
                stock_actual: 0, stock_minimo: stockMinimo,
                opcion_ids: combo.map(o => o.id),
                seleccionado: true, labels, margen: this.margenPct, codigo_barras: '',
                presentaciones: [], mostrarPresentaciones: false
            };
        });
    }

    private _cartesian(arrays: AtributoOpcion[][]): AtributoOpcion[][] {
        return arrays.reduce<AtributoOpcion[][]>(
            (acc, curr) => ([] as AtributoOpcion[][]).concat(...acc.map(a => curr.map(b => [...a, b]))),
            [[]]
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FLUJO VARIANTES — Paso 3 (SKUs)
    // ══════════════════════════════════════════════════════════════════════════

    get nombreBase(): string {
        return this.templateForm.get('nombre')!.value.trim().toUpperCase();
    }

    get skusSeleccionados(): SKUGenerado[] {
        return this.skusGenerados.filter(s => s.seleccionado);
    }

    toggleSKU(sku: SKUGenerado) { sku.seleccionado = !sku.seleccionado; }

    parsearPrecio(valor: string, sku: SKUGenerado, campo: 'costo' | 'venta') {
        const parsed = Math.round(this.currencyService.parse(valor) * 100) / 100;
        if (campo === 'costo') sku.precio_costo = parsed;
        else sku.precio_venta = parsed;
        sku.margen = calcularMargenDesdePrecio(sku.precio_costo, sku.precio_venta);
    }

    async seleccionarFotoSku(sku: SKUGenerado) {
        const source = this.storageService.isNative
            ? (await import('@capacitor/camera')).CameraSource.Camera
            : (await import('@capacitor/camera')).CameraSource.Photos;
        const result = await this.storageService.capturarFoto(source);
        if (!result) return;
        sku.imagenRawUrl     = result.rawUrl;
        sku.imagenPreviewUrl = result.rawUrl;
    }

    removerFotoSku(sku: SKUGenerado) {
        sku.imagenRawUrl = undefined;
        sku.imagenPreviewUrl = undefined;
    }

    async escanearCodigoSku(sku: SKUGenerado) {
        this.escaneando = true;
        const codigo = await this.barcodeScanner.scan();
        this.escaneando = false;
        if (!codigo) return;
        sku.codigo_barras = codigo;
        this.ui.showToast(`Codigo capturado: ${codigo}`, 'success');
    }

    async guardarVariantes() {
        const seleccionados = this.skusSeleccionados;
        if (seleccionados.length === 0) { this.ui.showToast('Selecciona al menos una variante', 'warning'); return; }
        if (this.guardando) return;
        this.guardando = true;

        const v = this.templateForm.value;
        const subfolder = this._subfolder(this._nombreCategoria(v.categoria_id));
        const uploadedPaths: string[] = [];

        try {
            let templateImagenUrl: string | null = null;
            if (this.templateFotoRawUrl) {
                templateImagenUrl = await this.storageService.uploadImage(this.templateFotoRawUrl, subfolder, false);
                if (!templateImagenUrl) { this.guardando = false; return; }
                uploadedPaths.push(templateImagenUrl);
            }

            const skuImagenUrls = await Promise.all(
                seleccionados.map(async sku => {
                    if (!sku.imagenRawUrl) return null;
                    const path = await this.storageService.uploadImage(sku.imagenRawUrl, subfolder, false);
                    if (path) uploadedPaths.push(path);
                    return path;
                })
            );

            // Subir imágenes pendientes de presentaciones de cada SKU
            const skuPresentaciones = await Promise.all(
                seleccionados.map(async sku => {
                    return Promise.all(sku.presentaciones.map(async p => {
                        let imagen_url = p.imagen_url ?? undefined;
                        if (imagen_url?.startsWith('__pending__')) {
                            const rawUrl = imagen_url.slice('__pending__'.length);
                            const path = await this.storageService.uploadImage(rawUrl, subfolder, false);
                            if (path) uploadedPaths.push(path);
                            imagen_url = path ?? undefined;
                        }
                        return { nombre: p.nombre, factor_conversion: p.factor_conversion, precio_venta: p.precio_venta, precio_costo: p.precio_costo, codigo_barras: p.codigo_barras, imagen_url };
                    }));
                })
            );

            const resultado = await this.productoSvc.crearConVariantes({
                nombre:      v.nombre,
                categoria_id: v.categoria_id,
                tiene_iva:   v.tiene_iva,
                tipo_venta:  v.tipo_venta,
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
                    imagen_url: skuImagenUrls[i] || null,
                    presentaciones: skuPresentaciones[i]
                }))
            });

            if (resultado.ok) {
                this.navCtrl.navigateBack(ROUTES.inventario.root);
            } else {
                await Promise.all(uploadedPaths.map(p => this.storageService.deleteFile(p)));
            }
        } catch (error) {
            this.logger.error('ProductoCrearPage', 'Error guardando variantes', error);
            await Promise.all(uploadedPaths.map(p => this.storageService.deleteFile(p)));
        } finally {
            this.guardando = false;
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private _nombreCategoria(categoriaId: string): string {
        return this.categorias.find(c => c.id === categoriaId)?.nombre || 'sin-categoria';
    }

    private _subfolder(nombre: string): string {
        return 'productos/' + nombre
            .toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }
}
