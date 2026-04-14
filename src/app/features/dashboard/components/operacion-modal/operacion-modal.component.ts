import { Component, inject, Input, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonSpinner,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, arrowDownOutline, arrowUpOutline, cameraOutline, closeCircle, imagesOutline, chevronDownOutline, businessOutline } from 'ionicons/icons';
import { OptionsModalComponent, ModalOptionGroup } from '@shared/components/options-modal/options-modal.component'; // usado en ModalController.create()
import { Subscription } from 'rxjs';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Caja } from '../../services/cajas.service';
import { CategoriaOperacion } from '../../models/categoria-operacion.model';
import { OperacionesCajaService } from '../../services/operaciones-caja.service';
import { UiService } from '@core/services/ui.service';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { NumbersOnlyDirective } from '@shared/directives/numbers-only.directive';

export interface OperacionModalData {
  tipo: 'INGRESO' | 'EGRESO';
  cajas: Caja[];
}

export interface OperacionModalResult {
  cajaId: number;
  categoriaId: number;
  monto: number;
  descripcion: string;
  fotoComprobante: string | null;
}

@Component({
  selector: 'app-operacion-modal',
  templateUrl: './operacion-modal.component.html',
  styleUrls: ['./operacion-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonSpinner,
    CurrencyInputDirective,
    NumbersOnlyDirective
  ]
})
export class OperacionModalComponent implements OnInit, OnDestroy {
  private modalCtrl = inject(ModalController);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);
  private operacionesService = inject(OperacionesCajaService);
  private ui = inject(UiService);

  @Input() tipo!: 'INGRESO' | 'EGRESO';
  @Input() cajas: Caja[] = [];
  @Input() cajaIdPreseleccionada?: number; // Nueva prop para pre-seleccionar caja

  form!: FormGroup;
  cajasFiltradas: Caja[] = [];
  categorias: CategoriaOperacion[] = [];
  cargandoCategorias = true;
  saldoCajaSeleccionada: number = 0;
  nombreCajaSeleccionada: string = '';
  fotoComprobante: string | null = null;
  private cajaIdSub?: Subscription;

  constructor() {
    addIcons({ closeOutline, arrowDownOutline, arrowUpOutline, cameraOutline, closeCircle, imagesOutline, chevronDownOutline, businessOutline });
  }

  async ngOnInit() {
    // Filtrar solo cajas donde se permite ingreso/egreso manual
    // v5: CAJA (vault), CAJA_CHICA (cajón diario), VARIOS (fondo emergencia)
    this.cajasFiltradas = this.cajas.filter(c =>
      ['CAJA', 'CAJA_CHICA', 'VARIOS'].includes(c.codigo)
    );

    // Pre-seleccionar caja si se especificó
    const cajaIdInicial = this.cajaIdPreseleccionada || null;

    // ⚠️ IMPORTANTE: Crear el form PRIMERO (síncronamente)
    // para evitar error "formGroup expects a FormGroup instance"
    this.form = this.fb.group({
      cajaId: [cajaIdInicial, Validators.required],
      categoriaId: [null, Validators.required],
      monto: [null, [Validators.required, Validators.min(0.01)]],
      descripcion: ['', this.tipo === 'EGRESO' ? Validators.required : []]
    });

    // Si hay caja pre-seleccionada, actualizar el saldo y nombre
    if (cajaIdInicial) {
      const caja = this.cajas.find(c => c.id === cajaIdInicial);
      this.saldoCajaSeleccionada = caja?.saldo_actual || 0;
      this.nombreCajaSeleccionada = caja?.nombre || '';
    }

    // Escuchar cambios en caja seleccionada
    this.cajaIdSub = this.form.get('cajaId')?.valueChanges.subscribe(cajaId => {
      const caja = this.cajas.find(c => c.id === cajaId);
      this.saldoCajaSeleccionada = caja?.saldo_actual || 0;
      this.nombreCajaSeleccionada = caja?.nombre || '';
    });

    // Cargar categorías según el tipo de operación (asíncronamente)
    try {
      this.cargandoCategorias = true;
      this.categorias = await this.operacionesService.obtenerCategorias(this.tipo);
    } catch (error: any) {
      this.categorias = [];
      await this.ui.showError('Error al cargar las categorías. Cerrá e intentá de nuevo.');
    } finally {
      this.cargandoCategorias = false;
    }
  }

  get esIngreso(): boolean {
    return this.tipo === 'INGRESO';
  }

  get titulo(): string {
    return this.esIngreso ? 'Registrar Ingreso' : 'Registrar Egreso';
  }

  get iconoTipo(): string {
    return this.esIngreso ? 'arrow-down-outline' : 'arrow-up-outline';
  }

  get colorTipo(): string {
    return this.esIngreso ? 'success' : 'danger';
  }

  get montoExcedeSaldo(): boolean {
    if (this.esIngreso) return false;
    const monto = this.form.get('monto')?.value || 0;
    return monto > this.saldoCajaSeleccionada;
  }

  ngOnDestroy() {
    this.cajaIdSub?.unsubscribe();
  }

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  get categoriaLabel(): string {
    const id = this.form?.get('categoriaId')?.value;
    if (!id) return 'Seleccionar categoría';
    return this.categorias.find(c => c.id === Number(id))?.nombre || 'Seleccionar categoría';
  }

  async abrirSelectorCategoria() {
    const groups: ModalOptionGroup[] = [{
      options: this.categorias.map(cat => ({
        label: cat.nombre,
        value: String(cat.id)
      }))
    }];

    const currentId = this.form.get('categoriaId')?.value;

    const modal = await this.modalCtrl.create({
      component: OptionsModalComponent,
      componentProps: {
        title: 'Categoría',
        groups,
        selectedValue: currentId ? String(currentId) : undefined
      },
      cssClass: 'options-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();

    if (data) {
      this.form.patchValue({ categoriaId: Number(data) });
      this.form.get('categoriaId')?.markAsTouched();
    }
  }

  async seleccionarFoto() {
    const groups: ModalOptionGroup[] = [{
      options: [
        { label: 'Tomar foto', icon: 'camera-outline', value: 'camera' },
        { label: 'Seleccionar de galería', icon: 'images-outline', value: 'gallery' },
      ]
    }];

    const modal = await this.modalCtrl.create({
      component: OptionsModalComponent,
      componentProps: { title: 'Comprobante', groups },
      cssClass: 'options-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();

    if (data === 'camera') this.tomarFoto(CameraSource.Camera);
    else if (data === 'gallery') this.tomarFoto(CameraSource.Photos);
  }

  async tomarFoto(source: CameraSource) {
    try {
      const image = await Camera.getPhoto({
        quality: 80,              // Calidad 80% (buen balance calidad/tamaño)
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: source,
        width: 1200,              // Limitar ancho máximo a 1200px
        height: 1600,             // Limitar alto máximo a 1600px
        correctOrientation: true  // Corregir orientación (importante!)
      });

      this.fotoComprobante = image.dataUrl || null;
      this.cdr.detectChanges(); // Forzar detección de cambios para web
    } catch {
      // El plugin lanza excepción al cancelar — no mostrar error al usuario
    }
  }

  removerFoto() {
    this.fotoComprobante = null;
    this.cdr.detectChanges(); // Forzar detección de cambios para web
  }

  confirmar() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    if (this.montoExcedeSaldo) {
      return;
    }

    // Validar comprobante obligatorio para egresos
    if (!this.esIngreso && !this.fotoComprobante) {
      return;
    }

    const result: OperacionModalResult = {
      cajaId: this.form.value.cajaId,
      categoriaId: this.form.value.categoriaId,
      monto: this.form.value.monto,
      descripcion: this.form.value.descripcion || '',
      fotoComprobante: this.fotoComprobante
    };

    this.modalCtrl.dismiss(result, 'confirm');
  }
}
