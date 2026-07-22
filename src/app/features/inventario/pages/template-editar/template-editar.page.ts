import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
    ModalController, NavController,
    IonHeader, IonToolbar, IonButtons, IonButton, IonTitle, IonContent,
    IonIcon, IonCard, IonCardContent, IonSkeletonText, IonSpinner,
    IonItem, IonInput, IonToggle
} from '@ionic/angular/standalone';
import { ActivatedRoute } from '@angular/router';
import { addIcons } from 'ionicons';
import {
    arrowBackOutline, saveOutline, cameraOutline, ellipsisHorizontal,
    chevronDownOutline, checkmarkCircleOutline, colorPaletteOutline,
    imageOutline, star
} from 'ionicons/icons';
import { ROUTES } from '../../../../core/config/routes.config';
import { UiService } from '../../../../core/services/ui.service';
import { FeedbackOverlayService } from '../../../../core/services/feedback-overlay.service';
import { StorageService } from '../../../../core/services/storage.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { HasPendingChanges } from '../../../../core/guards/pending-changes.guard';
import { ProductoTemplate, Producto } from '../../models/producto.model';
import { CategoriaProducto } from '../../models/categoria-producto.model';
import { InventarioService } from '../../services/inventario.service';
import { ProductoService } from '../../services/producto.service';
import { OptionsModalComponent, ModalOptionGroup } from '../../../../shared/components/options-modal/options-modal.component';

/**
 * Edición de los datos "generales" de un producto con variantes (el template):
 * nombre, categoría e imagen que representa a todo el grupo.
 *
 * Existe porque la edición de una variante solo toca la imagen del SKU
 * (productos.imagen_url), nunca la imagen general del grupo
 * (producto_templates.imagen_url). Sin esta página no había forma de agregar o
 * cambiar esa imagen después de crear el producto si no se subió en el wizard.
 *
 * Las variantes se muestran en solo-lectura como referencia — para editar una
 * en concreto, el usuario entra a ella desde el inventario.
 */
@Component({
    selector: 'app-template-editar',
    templateUrl: './template-editar.page.html',
    styleUrls: ['./template-editar.page.scss'],
    standalone: true,
    imports: [
        ReactiveFormsModule,
        IonHeader, IonToolbar, IonButtons, IonButton, IonTitle, IonContent,
        IonIcon, IonCard, IonCardContent, IonSkeletonText, IonSpinner,
        IonItem, IonInput, IonToggle,
    ]
})
export class TemplateEditarPage implements OnInit, HasPendingChanges {
    private navCtrl       = inject(NavController);
    private route         = inject(ActivatedRoute);
    private fb            = inject(FormBuilder);
    private inventarioSvc = inject(InventarioService);
    private productoSvc   = inject(ProductoService);
    private ui            = inject(UiService);
    private feedback      = inject(FeedbackOverlayService);
    protected storageService = inject(StorageService);
    private modalCtrl     = inject(ModalController);
    private logger        = inject(LoggerService);
    private cdr           = inject(ChangeDetectorRef);

    form!: FormGroup;
    cargando  = true;
    guardando = false;

    template!: ProductoTemplate;
    categorias: CategoriaProducto[] = [];

    /** Variantes del grupo — solo lectura (referencia visual). */
    variantes: Producto[] = [];

    // Imagen
    fotoPreviewUrl: SafeUrl | null = null;
    fotoRawUrl: string | null = null;
    imagenUrlExistente: string | null = null;
    private imagenPathAnterior: string | null = null;
    private fotoNueva     = false;
    private fotoEliminada = false;

    /** Bloquea aperturas concurrentes del flujo de imagen (doble-tap, etc.). */
    private procesandoImagen = false;

    // Textos del pendingChangesGuard
    readonly pendingChangesHeader  = '¿Descartar cambios?';
    readonly pendingChangesMessage = 'Los cambios en la plantilla se perderán si sales ahora.';

    constructor() {
        addIcons({
            arrowBackOutline, saveOutline, cameraOutline, ellipsisHorizontal,
            chevronDownOutline, checkmarkCircleOutline, colorPaletteOutline,
            imageOutline, star
        });
    }

    async ngOnInit() {
        const templateId = this.route.snapshot.paramMap.get('id')!;

        const [categorias, template, variantes] = await Promise.all([
            this.inventarioSvc.obtenerCategorias(),
            this.productoSvc.obtenerTemplatePorId(templateId),
            this.productoSvc.obtenerSKUsDelTemplate(templateId),
        ]);

        if (!template) {
            this.ui.showToast('Producto no encontrado', 'danger');
            this.navCtrl.navigateBack(ROUTES.inventario.root);
            return;
        }

        this.categorias = categorias;
        this.template   = template;

        // Resolver las miniaturas de las variantes (los SKUs guardan el path, no la URL firmada)
        const varianteUrls = await this.storageService.resolveImageUrls(variantes.map(v => v.imagen_url ?? null));
        this.variantes = variantes.map((v, i) => ({ ...v, imagen_url: varianteUrls[i] ?? undefined }));

        if (template.imagen_url) {
            this.imagenPathAnterior = template.imagen_url;
            this.imagenUrlExistente = await this.storageService.resolveImageUrl(template.imagen_url);
        }

        this.cargando = false;
        this._initForm();
        this.cdr.detectChanges();
    }

    private _initForm() {
        // Favorito all-or-nothing: el template está en favoritos si TODAS sus variantes lo están.
        const esFavorito = this.variantes.length > 0 && this.variantes.every(v => v.favorito);
        this.form = this.fb.group({
            nombre:       [this.template.nombre || '', [Validators.required, Validators.minLength(3), Validators.maxLength(100)]],
            categoria_id: [this.template.categoria_id ?? null, [Validators.required]],
            favorito:     [esFavorito],
        });
    }

    // ── pendingChangesGuard ───────────────────────────────────────────────────

    hasPendingChanges(): boolean {
        return this.form?.dirty === true || this.fotoNueva || this.fotoEliminada;
    }

    resetState() {
        this.form?.reset();
        this.fotoNueva = false;
        this.fotoEliminada = false;
    }

    // ── Categoría ─────────────────────────────────────────────────────────────

    get categoriaLabel(): string {
        const id = this.form?.get('categoria_id')?.value;
        if (!id) return 'Seleccionar categoría *';
        return this.categorias.find(c => c.id === id)?.nombre || 'Seleccionar categoría *';
    }

    esCampoInvalido(campo: string): boolean {
        const ctrl = this.form?.get(campo);
        return !!(ctrl && ctrl.invalid && (ctrl.dirty || ctrl.touched));
    }

    async abrirSelectorCategoria() {
        const groups: ModalOptionGroup[] = [{
            title: 'Categorías',
            options: this.categorias.map(cat => ({ label: cat.nombre, value: String(cat.id) }))
        }];
        const currentId = this.form.get('categoria_id')?.value;
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
        this.form.get('categoria_id')?.markAsTouched();
        if (data) {
            this.form.get('categoria_id')?.setValue(data);
            this.form.get('categoria_id')?.markAsDirty();
        }
    }

    // ── Imagen ────────────────────────────────────────────────────────────────

    async seleccionarFoto() {
        if (this.procesandoImagen) return;
        this.procesandoImagen = true;
        try {
            const result = await this.storageService.elegirFuenteFoto();
            if (!result) return;
            this._aplicarFoto(result.previewUrl, result.rawUrl);
        } finally {
            this.procesandoImagen = false;
        }
    }

    async abrirOpcionesImagen() {
        if (this.procesandoImagen) return;
        this.procesandoImagen = true;
        try {
            const accion = await this.storageService.mostrarOpcionesImagen();
            if (!accion) return;

            if (accion === 'quitar') {
                this._removerFoto();
                return;
            }

            if (accion === 'cambiar') {
                this.procesandoImagen = false;
                await this.seleccionarFoto();
                return;
            }

            // 'recortar' — reusa la imagen actual (local o existente)
            const url = this.fotoRawUrl ?? this.imagenUrlExistente;
            if (!url) {
                this.procesandoImagen = false;
                await this.seleccionarFoto();
                return;
            }
            const result = await this.storageService.recortarImagen(url);
            if (!result) return;
            this._aplicarFoto(result.previewUrl, result.rawUrl);
        } finally {
            this.procesandoImagen = false;
        }
    }

    private _aplicarFoto(previewUrl: SafeUrl, rawUrl: string) {
        this.fotoPreviewUrl     = previewUrl;
        this.fotoRawUrl         = rawUrl;
        this.imagenUrlExistente = null;
        this.fotoNueva          = true;
        this.fotoEliminada      = false;
        this.form.markAsDirty();
    }

    private _removerFoto() {
        if (this.imagenPathAnterior && !this.fotoNueva) this.fotoEliminada = true;
        this.fotoPreviewUrl     = null;
        this.fotoRawUrl         = null;
        this.imagenUrlExistente = null;
        this.fotoNueva          = false;
        this.form.markAsDirty();
    }

    // ── Guardar ───────────────────────────────────────────────────────────────

    async guardar() {
        if (this.form.invalid || this.guardando) {
            this.form.markAllAsTouched();
            return;
        }
        this.guardando = true;
        const v = this.form.value;

        try {
            let imagenPath: string | null = this.imagenPathAnterior;

            if (this.fotoNueva && this.fotoRawUrl) {
                const subfolder = this._subfolder(this._nombreCategoria(v.categoria_id));
                const nuevo = await this.storageService.replaceImage(
                    this.fotoRawUrl, subfolder, this.imagenPathAnterior ?? null, false
                );
                if (!nuevo) { this.guardando = false; return; }
                imagenPath = nuevo;
            } else if (this.fotoEliminada) {
                if (this.imagenPathAnterior) await this.storageService.deleteFile(this.imagenPathAnterior);
                imagenPath = null;
            }

            const res = await this.productoSvc.actualizarTemplate({
                template_id:  this.template.id,
                nombre:       v.nombre,
                categoria_id: v.categoria_id,
                imagen_url:   imagenPath,
            });

            // res.ok === false: falló (call() ya mostró el toast de error real) — no
            // navegar, el usuario conserva el formulario para reintentar.
            if (!res.ok) { this.guardando = false; return; }

            // Favorito all-or-nothing: si cambió, marcar/desmarcar TODAS las variantes.
            const favoritoActual = this.variantes.length > 0 && this.variantes.every(x => x.favorito);
            if (!!v.favorito !== favoritoActual) {
                await this.productoSvc.toggleFavoritoTemplate(this.template.id, !!v.favorito);
            }

            this.form.markAsPristine();
            this.fotoNueva = false;
            this.fotoEliminada = false;
            // Overlay ANTES de navegar: un toast aquí competiría con la transición de
            // página y se perdería (ver design_toast_vs_overlay_feedback.md).
            this.feedback.success({ titulo: 'Plantilla actualizada', destacado: v.nombre });
            this.navCtrl.navigateBack(ROUTES.inventario.root);
        } catch (error) {
            this.logger.error('TemplateEditarPage', 'Error guardando template', error);
        } finally {
            this.guardando = false;
        }
    }

    volver() {
        this.navCtrl.navigateBack(ROUTES.inventario.root);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

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
