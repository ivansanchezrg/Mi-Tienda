import { Component, inject, Input, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SafeUrl } from '@angular/platform-browser';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import {
  IonIcon, IonSpinner, IonButton,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, arrowDownOutline, arrowUpOutline, cameraOutline, closeCircle,
  chevronDownOutline, cashOutline, fileTrayOutline, archiveOutline
} from 'ionicons/icons';
import { OptionsModalComponent, ModalOptionGroup } from '@shared/components/options-modal/options-modal.component';
import { Subscription } from 'rxjs';
import { StorageService } from '@core/services/storage.service';
import { Caja } from '../../services/cajas.service';
import { CategoriaOperacion } from '../../models/categoria-operacion.model';
import { OperacionesCajaService } from '../../services/operaciones-caja.service';
import { UiService } from '@core/services/ui.service';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { NumbersOnlyDirective } from '@shared/directives/numbers-only.directive';
import { HorizontalScrollDirective } from '@shared/directives/horizontal-scroll.directive';
import { AppCurrencyPipe } from '@shared/pipes/app-currency.pipe';

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

// Iconos por código de caja
const CAJA_ICONOS: Record<string, string> = {
  CAJA:       'cash-outline',
  CAJA_CHICA: 'file-tray-outline',
  VARIOS:     'archive-outline',
};

@Component({
  selector: 'app-operacion-modal',
  templateUrl: './operacion-modal.component.html',
  styleUrls: ['./operacion-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonIcon, IonSpinner, IonButton,
    CurrencyInputDirective,
    NumbersOnlyDirective,
    HorizontalScrollDirective,
    AppCurrencyPipe,
  ]
})
export class OperacionModalComponent implements OnInit, OnDestroy {
  private modalCtrl   = inject(ModalController);
  private fb          = inject(FormBuilder);
  private cdr         = inject(ChangeDetectorRef);
  private operacionesService = inject(OperacionesCajaService);
  private ui          = inject(UiService);
  protected storageService   = inject(StorageService);

  @Input() tipo!: 'INGRESO' | 'EGRESO';
  @Input() cajas: Caja[] = [];
  @Input() cajaIdPreseleccionada?: string;
  @Input() excluirCajaChica = false;
  @Input() variosActiva = false;

  form!: FormGroup;
  cajasFiltradas: Caja[] = [];
  categorias: CategoriaOperacion[] = [];
  cargandoCategorias = true;
  saldoCajaSeleccionada = 0;
  fotoPreviewUrl: SafeUrl | null = null;
  fotoRawUrl: string | null = null;
  private cajaIdSub?: Subscription;

  constructor() {
    addIcons({
      closeOutline, arrowDownOutline, arrowUpOutline, cameraOutline, closeCircle,
      chevronDownOutline, cashOutline, fileTrayOutline, archiveOutline
    });
  }

  async ngOnInit() {
    this.cajasFiltradas = this.cajas.filter(c => {
      if (this.excluirCajaChica && c.codigo === 'CAJA_CHICA') return false;
      if (!this.variosActiva   && c.codigo === 'VARIOS')      return false;
      return ['CAJA', 'CAJA_CHICA', 'VARIOS'].includes(c.codigo) || c.codigo.startsWith('CUSTOM_');
    });

    // Preseleccionar: si viene cajaIdPreseleccionada, usarla;
    // si solo hay una caja disponible, seleccionarla automáticamente
    const cajaIdInicial =
      this.cajaIdPreseleccionada ??
      (this.cajasFiltradas.length === 1 ? this.cajasFiltradas[0].id : null);

    this.form = this.fb.group({
      cajaId:      [cajaIdInicial, Validators.required],
      categoriaId: [null, Validators.required],
      monto:       [null, [Validators.required, Validators.min(0.01)]],
      descripcion: ['']
    });

    if (cajaIdInicial) {
      const caja = this.cajas.find(c => c.id === cajaIdInicial);
      this.saldoCajaSeleccionada = caja?.saldo_actual ?? 0;
    }

    this.cajaIdSub = this.form.get('cajaId')?.valueChanges.subscribe(cajaId => {
      const caja = this.cajas.find(c => c.id === cajaId);
      this.saldoCajaSeleccionada = caja?.saldo_actual ?? 0;
    });

    try {
      this.cargandoCategorias = true;
      this.categorias = await this.operacionesService.obtenerCategorias(this.tipo);
    } catch {
      this.categorias = [];
      await this.ui.showError('Error al cargar las categorías. Cierra e intenta de nuevo.');
    } finally {
      this.cargandoCategorias = false;
    }
  }

  ngOnDestroy() {
    this.cajaIdSub?.unsubscribe();
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  get cajaPreseleccionada() {
    return this.cajas.find(c => c.id === this.cajaIdPreseleccionada);
  }

  get esIngreso(): boolean {
    return this.tipo === 'INGRESO';
  }

  get titulo(): string {
    return this.esIngreso ? 'Registrar Ingreso' : 'Registrar Egreso';
  }

  get montoExcedeSaldo(): boolean {
    if (this.esIngreso) return false;
    return (this.form.get('monto')?.value ?? 0) > this.saldoCajaSeleccionada;
  }

  get categoriaLabel(): string {
    const id = this.form?.get('categoriaId')?.value;
    if (!id) return 'Seleccionar categoría';
    return this.categorias.find(c => c.id === id)?.nombre ?? 'Seleccionar categoría';
  }

  get requiereDescripcion(): boolean {
    const id = this.form?.get('categoriaId')?.value;
    if (!id) return false;
    const nombre = this.categorias.find(c => c.id === id)?.nombre ?? '';
    return /otros?/i.test(nombre);
  }

  iconoCaja(codigo: string, icono?: string): string {
    return icono || CAJA_ICONOS[codigo] || 'cash-outline';
  }

  // ── Acciones ───────────────────────────────────────────────────────────────

  seleccionarCaja(caja: Caja) {
    this.form.patchValue({ cajaId: caja.id });
    this.form.get('cajaId')?.markAsTouched();
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`.caja-scroll [data-caja-id="${caja.id}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 0);
  }

  async abrirSelectorCategoria() {
    const groups: ModalOptionGroup[] = [{
      options: this.categorias.map(cat => ({ label: cat.nombre, value: String(cat.id) }))
    }];

    const modal = await this.modalCtrl.create({
      component: OptionsModalComponent,
      componentProps: {
        title: 'Categoría',
        groups,
        selectedValue: this.form.get('categoriaId')?.value
          ? String(this.form.get('categoriaId')!.value)
          : undefined
      },
      cssClass: 'options-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data) {
      this.form.patchValue({ categoriaId: data, descripcion: '' });
      this.form.get('categoriaId')?.markAsTouched();
      this.actualizarValidadorDescripcion();
    }
  }

  private actualizarValidadorDescripcion() {
    const ctrl = this.form.get('descripcion');
    if (!ctrl) return;
    if (this.requiereDescripcion) {
      ctrl.setValidators([Validators.required, Validators.minLength(3)]);
    } else {
      ctrl.clearValidators();
    }
    ctrl.updateValueAndValidity();
  }

  async seleccionarFoto() {
    // Flujo centralizado: menú de fuente + captura, sin recorte (comprobantes)
    const result = await this.storageService.elegirFuenteFoto('libre', false, false);
    if (result) {
      this.fotoPreviewUrl = result.previewUrl;
      this.fotoRawUrl     = result.rawUrl;
    }
    this.cdr.detectChanges();
  }

  removerFoto() {
    this.fotoPreviewUrl = null;
    this.fotoRawUrl     = null;
    this.cdr.detectChanges();
  }

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  confirmar() {
    if (this.form.invalid || this.montoExcedeSaldo) {
      this.form.markAllAsTouched();
      return;
    }

    const result: OperacionModalResult = {
      cajaId:          this.form.value.cajaId,
      categoriaId:     this.form.value.categoriaId,
      monto:           this.form.value.monto,
      descripcion:     this.form.value.descripcion ?? '',
      fotoComprobante: this.fotoRawUrl
    };

    this.modalCtrl.dismiss(result, 'confirm');
  }
}
