import { Component, inject, Input, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SafeUrl } from '@angular/platform-browser';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonSpinner,
  ModalController, AlertController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, arrowDownOutline, arrowUpOutline, cameraOutline, closeCircle, chevronDownOutline, businessOutline } from 'ionicons/icons';
import { OptionsModalComponent, ModalOptionGroup } from '@shared/components/options-modal/options-modal.component'; // usado en ModalController.create()
import { Subscription } from 'rxjs';
import { CameraSource } from '@capacitor/camera';
import { StorageService } from '@core/services/storage.service';
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
  cajaId: string;
  categoriaId: string;
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
  private alertCtrl = inject(AlertController);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);
  private operacionesService = inject(OperacionesCajaService);
  private ui = inject(UiService);
  protected storageService = inject(StorageService);

  @Input() tipo!: 'INGRESO' | 'EGRESO';
  @Input() cajas: Caja[] = [];
  @Input() cajaIdPreseleccionada?: string;

  form!: FormGroup;
  cajasFiltradas: Caja[] = [];
  categorias: CategoriaOperacion[] = [];
  cargandoCategorias = true;
  saldoCajaSeleccionada: number = 0;
  nombreCajaSeleccionada: string = '';
  fotoPreviewUrl: SafeUrl | null = null;  // para <img [src]>
  fotoRawUrl: string | null = null;       // para uploadImage() al confirmar
  private cajaIdSub?: Subscription;

  constructor() {
    addIcons({ closeOutline, arrowDownOutline, arrowUpOutline, cameraOutline, closeCircle, chevronDownOutline, businessOutline });
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
      await this.ui.showError('Error al cargar las categorías. Cierra e intenta de nuevo.');
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
    return this.categorias.find(c => c.id === id)?.nombre || 'Seleccionar categoría';
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
      this.form.patchValue({ categoriaId: data });
      this.form.get('categoriaId')?.markAsTouched();
    }
  }

  async seleccionarFoto() {
    const buttons: any[] = [];
    if (this.storageService.isNative) {
      buttons.push({ text: 'Tomar foto', handler: () => this.tomarFoto(CameraSource.Camera) });
    }
    buttons.push({ text: 'Seleccionar de galería', handler: () => this.tomarFoto(CameraSource.Photos) });
    buttons.push({ text: 'Cancelar', role: 'cancel' });

    const alert = await this.alertCtrl.create({ header: 'Comprobante', buttons });
    await alert.present();
  }

  private async tomarFoto(source: CameraSource) {
    const result = await this.storageService.capturarFoto(source);
    if (result) {
      this.fotoPreviewUrl = result.previewUrl;
      this.fotoRawUrl = result.rawUrl;
    }
    this.cdr.detectChanges();
  }

  removerFoto() {
    this.fotoPreviewUrl = null;
    this.fotoRawUrl = null;
    this.cdr.detectChanges();
  }

  confirmar() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    if (this.montoExcedeSaldo) {
      return;
    }

    if (!this.esIngreso && !this.fotoRawUrl) {
      return;
    }

    const result: OperacionModalResult = {
      cajaId: this.form.value.cajaId,
      categoriaId: this.form.value.categoriaId,
      monto: this.form.value.monto,
      descripcion: this.form.value.descripcion || '',
      fotoComprobante: this.fotoRawUrl
    };

    this.modalCtrl.dismiss(result, 'confirm');
  }
}
