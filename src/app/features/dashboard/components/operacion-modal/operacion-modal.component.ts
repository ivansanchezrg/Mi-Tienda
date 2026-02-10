import { Component, inject, Input, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonContent, IonIcon, IonSpinner,
  ModalController, ActionSheetController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, arrowDownOutline, arrowUpOutline, cameraOutline, closeCircle, imagesOutline } from 'ionicons/icons';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Caja } from '../../services/cajas.service';
import { CategoriaOperacion } from '../../models/categoria-operacion.model';
import { OperacionesCajaService } from '../../services/operaciones-caja.service';
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
export class OperacionModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private fb = inject(FormBuilder);
  private actionSheetCtrl = inject(ActionSheetController);
  private cdr = inject(ChangeDetectorRef);
  private operacionesService = inject(OperacionesCajaService);

  @Input() tipo!: 'INGRESO' | 'EGRESO';
  @Input() cajas: Caja[] = [];
  @Input() cajaIdPreseleccionada?: number; // Nueva prop para pre-seleccionar caja

  form!: FormGroup;
  cajasFiltradas: Caja[] = [];
  categorias: CategoriaOperacion[] = [];
  cargandoCategorias = true;
  saldoCajaSeleccionada: number = 0;
  nombreCajaSeleccionada: string = '';
  fotoComprobante: string | null = null; // URL de la foto cargada

  constructor() {
    addIcons({ closeOutline, arrowDownOutline, arrowUpOutline, cameraOutline, closeCircle, imagesOutline });
  }

  async ngOnInit() {
    // Filtrar solo cajas donde se permite ingreso/egreso manual
    // Por ahora: CAJA y CAJA_CHICA
    this.cajasFiltradas = this.cajas.filter(c =>
      ['CAJA', 'CAJA_CHICA'].includes(c.codigo)
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
    this.form.get('cajaId')?.valueChanges.subscribe(cajaId => {
      const caja = this.cajas.find(c => c.id === cajaId);
      this.saldoCajaSeleccionada = caja?.saldo_actual || 0;
      this.nombreCajaSeleccionada = caja?.nombre || '';
    });

    // Cargar categorías según el tipo de operación (asíncronamente)
    try {
      this.cargandoCategorias = true;
      this.categorias = await this.operacionesService.obtenerCategorias(this.tipo);
    } catch (error) {
      console.error('Error al cargar categorías:', error);
      this.categorias = [];
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

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async seleccionarFoto() {
    const actionSheet = await this.actionSheetCtrl.create({
      header: 'Seleccionar comprobante',
      buttons: [
        {
          text: 'Tomar foto',
          icon: 'camera-outline',
          handler: () => {
            this.tomarFoto(CameraSource.Camera);
          }
        },
        {
          text: 'Seleccionar de galería',
          icon: 'images-outline',
          handler: () => {
            this.tomarFoto(CameraSource.Photos);
          }
        },
        {
          text: 'Cancelar',
          icon: 'close',
          role: 'cancel'
        }
      ]
    });

    await actionSheet.present();
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
    } catch (error) {
      console.error('Error al tomar/seleccionar foto:', error);
      // Si el usuario cancela, no hacer nada
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
