import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
    AlertController, NavController, IonHeader, IonToolbar, IonButtons, IonButton,
    IonTitle, IonContent, IonIcon, IonCard, IonCardContent, IonSkeletonText, IonSpinner,
    IonToggle, ViewWillEnter
} from '@ionic/angular/standalone';
import { ActivatedRoute } from '@angular/router';
import { addIcons } from 'ionicons';
import {
    arrowBackOutline, saveOutline, informationCircleOutline,
    trashOutline, refreshOutline, warningOutline, checkmarkCircleOutline, star
} from 'ionicons/icons';
import { ROUTES } from '../../../../core/config/routes.config';
import { CurrencyService } from '../../../../core/services/currency.service';
import { UiService } from '../../../../core/services/ui.service';
import { FeedbackOverlayService } from '../../../../core/services/feedback-overlay.service';
import { StorageService } from '../../../../core/services/storage.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { Producto, ProductoTemplate, Atributo, AtributoOpcion } from '../../models/producto.model';
import { CategoriaProducto } from '../../models/categoria-producto.model';
import { InventarioService } from '../../services/inventario.service';
import { ProductoService } from '../../services/producto.service';
import { ProductoInfoFormComponent, FotoSeleccionada } from '../../components/producto-info-form/producto-info-form.component';
import { ProductoPreciosFormComponent } from '../../components/producto-precios-form/producto-precios-form.component';
import { ProductoInventarioFormComponent } from '../../components/producto-inventario-form/producto-inventario-form.component';
import { ProductoPresentacionesComponent } from '../../components/producto-presentaciones/producto-presentaciones.component';

interface AtributoSeleccionado {
    atributo: Atributo;
    opcion: AtributoOpcion;
}

@Component({
    selector: 'app-producto-editar',
    templateUrl: './producto-editar.page.html',
    styleUrls: ['./producto-editar.page.scss'],
    standalone: true,
    imports: [
        ReactiveFormsModule,
        IonHeader, IonToolbar, IonButtons, IonButton, IonTitle,
        IonContent, IonIcon, IonCard, IonCardContent, IonSkeletonText, IonSpinner, IonToggle,
        ProductoInfoFormComponent,
        ProductoPreciosFormComponent,
        ProductoInventarioFormComponent,
        ProductoPresentacionesComponent,
    ]
})
export class ProductoEditarPage implements OnInit, ViewWillEnter {
    private navCtrl         = inject(NavController);
    private route           = inject(ActivatedRoute);
    private fb              = inject(FormBuilder);
    private inventarioSvc   = inject(InventarioService);
    private productoSvc     = inject(ProductoService);
    protected currencyService = inject(CurrencyService);
    private ui              = inject(UiService);
    private feedback         = inject(FeedbackOverlayService);
    protected storageService = inject(StorageService);
    private alertCtrl       = inject(AlertController);
    private logger          = inject(LoggerService);
    private cdr             = inject(ChangeDetectorRef);

    productoForm!: FormGroup;
    cargando  = true;
    guardando = false;

    producto!: Producto;
    categorias: CategoriaProducto[] = [];

    // Variante context (readonly)
    templateSeleccionado: ProductoTemplate | null = null;
    variantesHermanas: Producto[] = [];
    atributosSeleccionados: AtributoSeleccionado[] = [];

    // Imagen
    fotoPreviewUrl: SafeUrl | null = null;
    fotoRawUrl: string | null = null;
    imagenUrlExistente: string | null = null;
    private imagenPathAnterior: string | null = null;
    private fotoNueva      = false;
    private fotoEliminada  = false;

    // Storage subfolder para presentaciones
    storageSubfolder = 'productos/sin-categoria';

    constructor() {
        addIcons({
            arrowBackOutline, saveOutline, informationCircleOutline,
            trashOutline, refreshOutline, warningOutline, checkmarkCircleOutline, star
        });
    }

    async ngOnInit() {
        const productoId = this.route.snapshot.paramMap.get('id')!;

        const [categorias, producto] = await Promise.all([
            this.inventarioSvc.obtenerCategorias(),
            this.productoSvc.obtenerPorId(productoId)
        ]);

        if (!producto) {
            this.ui.showToast('Producto no encontrado', 'danger');
            this.navCtrl.navigateBack(ROUTES.inventario.root);
            return;
        }

        this.categorias = categorias;
        this.producto   = producto;

        if (producto.imagen_url) {
            this.imagenPathAnterior  = producto.imagen_url;
            this.imagenUrlExistente  = await this.storageService.resolveImageUrl(producto.imagen_url);
        }

        if (producto.producto_template) {
            this.templateSeleccionado = producto.producto_template;
            const [hermanas, atributosRaw] = await Promise.all([
                this.productoSvc.obtenerSKUsDelTemplate(producto.producto_template.id, producto.id),
                this.inventarioSvc.obtenerAtributosProducto(producto.id),
            ]);
            this.variantesHermanas = hermanas;
            this.atributosSeleccionados = atributosRaw
                .filter(pa => pa.atributo_opcion?.atributo)
                .map(pa => ({ atributo: pa.atributo_opcion!.atributo!, opcion: pa.atributo_opcion! }));
        }

        this.storageSubfolder = this._subfolder(
            categorias.find(c => c.id === (producto.categoria_id ?? producto.producto_template?.categoria_id))?.nombre
        );

        this.cargando = false;
        this._initForm();
        this.cdr.detectChanges();
    }

    async ionViewWillEnter() {
        if (!this.producto || !this.productoForm) return;
        const actualizado = await this.productoSvc.obtenerPorId(this.producto.id);
        if (!actualizado) return;
        this.producto.stock_actual = actualizado.stock_actual;
        this.productoForm.patchValue({ stock_actual: actualizado.stock_actual }, { emitEvent: false });
    }

    private _initForm() {
        const categoriaId = this.producto.categoria_id
            ?? this.producto.producto_template?.categoria_id
            ?? null;

        this.productoForm = this.fb.group({
            codigo_barras:  [this.producto.codigo_barras || ''],
            nombre:         [this.producto.nombre || '', [Validators.required, Validators.minLength(3), Validators.maxLength(100)]],
            categoria_id:   [categoriaId, [Validators.required]],
            precio_costo:   [this.producto.precio_costo || '', [Validators.required, Validators.min(0.01)]],
            precio_venta:   [this.producto.precio_venta || '', [Validators.required, Validators.min(0.01)]],
            stock_actual:   [this.producto.stock_actual ?? 0, [Validators.required, Validators.min(0)]],
            stock_minimo:   [this.producto.stock_minimo ?? 5, [Validators.required, Validators.min(0)]],
            tiene_iva:      [this.producto.tiene_iva ?? true],
            tipo_venta:     [this.producto.tipo_venta || 'UNIDAD'],
            unidad_medida:  [this.producto.unidad_medida || 'und'],
            favorito:       [this.producto.favorito ?? false],
        });
    }

    // ── Foto ────────────────────────────────────────────────────────────────

    onFotoSeleccionada(event: FotoSeleccionada) {
        this.fotoPreviewUrl     = event.previewUrl;
        this.fotoRawUrl         = event.rawUrl;
        this.imagenUrlExistente = null;
        this.fotoNueva          = true;
        this.fotoEliminada      = false;
        this.productoForm.markAsDirty();
    }

    onFotoRemovida() {
        if (this.imagenPathAnterior && !this.fotoNueva) this.fotoEliminada = true;
        this.fotoPreviewUrl     = null;
        this.fotoRawUrl         = null;
        this.imagenUrlExistente = null;
        this.fotoNueva          = false;
        this.productoForm.markAsDirty();
    }

    // ── Guardar ─────────────────────────────────────────────────────────────

    async guardar() {
        if (this.productoForm.invalid || this.guardando) {
            this.productoForm.markAllAsTouched();
            return;
        }
        this.guardando = true;
        const v = this.productoForm.value;

        try {
            let imagenUrl: string | null = null;

            if (this.fotoNueva && this.fotoRawUrl) {
                const subfolder = this._subfolder(this._nombreCategoria(v.categoria_id));
                imagenUrl = await this.storageService.replaceImage(
                    this.fotoRawUrl, subfolder, this.imagenPathAnterior ?? null, false
                );
                if (!imagenUrl) { this.guardando = false; return; }
            }

            const payload: Partial<Producto> = {
                ...v,
                codigo_barras: v.codigo_barras?.trim() || null,
                precio_costo:  this.currencyService.parse(v.precio_costo),
                precio_venta:  this.currencyService.parse(v.precio_venta),
                stock_actual:  Number(v.stock_actual) || 0,
                stock_minimo:  Number(v.stock_minimo) || 0,
                unidad_medida: v.tipo_venta === 'PESO' ? v.unidad_medida : 'und',
            };

            if (imagenUrl) {
                payload.imagen_url = imagenUrl;
            } else if (this.fotoEliminada) {
                if (this.imagenPathAnterior) await this.storageService.deleteFile(this.imagenPathAnterior);
                payload.imagen_url = null;
            }

            const actualizado = await this.productoSvc.actualizar(this.producto.id, payload);
            // null = falló (call() ya mostró el toast de error con el motivo real) — no
            // navegar, así el usuario no pierde el formulario ni el contexto del fallo.
            if (!actualizado) { this.guardando = false; return; }

            this.productoForm.markAsPristine();
            // Overlay ANTES de navegar: un toast aquí competiría con la transición de
            // página y se perdería (ver design_toast_vs_overlay_feedback.md).
            this.feedback.success({ titulo: 'Producto actualizado', destacado: actualizado.nombre });
            this.navCtrl.navigateBack(ROUTES.inventario.root);
        } catch (error) {
            this.logger.error('ProductoEditarPage', 'Error guardando', error);
        } finally {
            this.guardando = false;
        }
    }

    // ── Acciones ─────────────────────────────────────────────────────────────

    abrirKardex() {
        this.navCtrl.navigateForward(ROUTES.inventario.kardex(this.producto.id), {
            queryParams: { nombre: this.producto.nombre, stock: this.producto.stock_actual }
        });
    }

    async desactivar() {
        const alert = await this.alertCtrl.create({
            header: `¿Quitar "${this.producto.nombre}"?`,
            message: 'Dejara de aparecer en el inventario y el POS. Puedes reactivarlo cuando quieras.',
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Quitar', role: 'destructive',
                    handler: async () => {
                        await this.productoSvc.desactivar(this.producto.id);
                        this.navCtrl.navigateBack(ROUTES.inventario.root);
                    }
                }
            ]
        });
        await alert.present();
    }

    async reactivar() {
        const alert = await this.alertCtrl.create({
            header: 'Reactivar producto',
            message: `"${this.producto.nombre}" volvera a aparecer en el inventario y el POS.`,
            buttons: [
                { text: 'Cancelar', role: 'cancel' },
                {
                    text: 'Reactivar',
                    handler: async () => {
                        await this.productoSvc.reactivar(this.producto.id);
                        this.producto.activo = true;
                        this.cdr.detectChanges();
                    }
                }
            ]
        });
        await alert.present();
    }

    volver() {
        this.navCtrl.navigateBack(ROUTES.inventario.root);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private _nombreCategoria(categoriaId: string): string {
        return this.categorias.find(c => c.id === categoriaId)?.nombre || 'sin-categoria';
    }

    private _subfolder(nombre?: string): string {
        return 'productos/' + (nombre ?? 'sin-categoria')
            .toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }

}
