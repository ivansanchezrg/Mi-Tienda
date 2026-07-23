import { Component, inject, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { IonIcon, IonButton, IonSpinner, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  closeOutline, addCircleOutline, createOutline, chevronDownOutline, chevronUpOutline,
  fileTrayOutline,
  // Finanzas
  cashOutline, walletOutline, cardOutline, diamondOutline, trophyOutline,
  ribbonOutline, medalOutline,
  // Comercio
  storefrontOutline, bagOutline, cartOutline, pricetagOutline, barcodeOutline,
  qrCodeOutline, receiptOutline, ticketOutline, giftOutline, basketOutline,
  // Edificios / Lugares
  businessOutline, homeOutline, libraryOutline, schoolOutline, buildOutline,
  hammerOutline, constructOutline,
  // Transporte
  carOutline, busOutline, bicycleOutline, boatOutline, airplaneOutline,
  trainOutline, walkOutline,
  // Tecnología
  desktopOutline, laptopOutline, phonePortraitOutline, watchOutline,
  tvOutline, cameraOutline,
  // Comida y servicios
  restaurantOutline, pizzaOutline, beerOutline, wineOutline, cafeOutline,
  iceCreamOutline, fastFoodOutline, nutritionOutline,
  // Naturaleza
  leafOutline, flowerOutline, earthOutline, sunnyOutline, moonOutline,
  waterOutline, flameOutline,
  // General
  starOutline, heartOutline, flashOutline, shieldCheckmarkOutline,
  keyOutline, flagOutline, bookmarkOutline, alarmOutline,
  peopleOutline, personOutline, settingsOutline,
  statsChartOutline, pieChartOutline, analyticsOutline,
  briefcaseOutline, cubeOutline, archiveOutline, layersOutline,
  calculatorOutline, lockClosedOutline,
} from 'ionicons/icons';
import { CajasService, Caja } from '../../services/cajas.service';
import { CurrencyInputDirective } from '@shared/directives/currency-input.directive';
import { CurrencyService } from '@core/services/currency.service';
import { NumbersOnlyDirective } from '@shared/directives/numbers-only.directive';

export interface IconOption {
  value: string;
}

export interface ColorOption {
  value: string;
  label: string;
}

const ICONS_VISIBLE  = 8;
const COLORS_VISIBLE = 8;

@Component({
  selector: 'app-nueva-caja-modal',
  templateUrl: './nueva-caja-modal.component.html',
  styleUrls: ['./nueva-caja-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IonIcon, IonButton, IonSpinner,
    CurrencyInputDirective,
    NumbersOnlyDirective,
  ]
})
export class NuevaCajaModalComponent implements OnInit {
  private modalCtrl    = inject(ModalController);
  private fb           = inject(FormBuilder);
  private cajasService = inject(CajasService);
  private currency     = inject(CurrencyService);

  /** Cajas existentes — se usan para filtrar íconos y colores ya en uso */
  @Input() cajasExistentes: Caja[] = [];

  /** Si se pasa, el modal opera en modo edición */
  @Input() cajaEditar?: Caja;

  form!: FormGroup;
  guardando = false;
  iconosExpandidos = false;

  // Íconos principales — los 8 más relevantes para cajas de negocio
  private readonly ICONS_MAIN: string[] = [
    'cash-outline',
    'wallet-outline',
    'card-outline',
    'storefront-outline',
    'business-outline',
    'library-outline',
    'briefcase-outline',
    'receipt-outline',
  ];

  // Íconos extra agrupados por categoría — visibles al expandir
  private readonly ICONS_EXTRA: string[] = [
    // Finanzas
    'diamond-outline', 'trophy-outline', 'ribbon-outline', 'medal-outline',
    'stats-chart-outline', 'pie-chart-outline', 'analytics-outline', 'calculator-outline',
    // Comercio
    'bag-outline', 'cart-outline', 'pricetag-outline', 'barcode-outline',
    'qr-code-outline', 'ticket-outline', 'gift-outline', 'basket-outline',
    // Lugares
    'home-outline', 'school-outline', 'build-outline', 'hammer-outline',
    'construct-outline', 'flag-outline', 'bookmark-outline', 'key-outline',
    // Transporte
    'car-outline', 'bus-outline', 'bicycle-outline', 'boat-outline',
    'airplane-outline', 'train-outline', 'walk-outline',
    // Tecnología
    'desktop-outline', 'laptop-outline', 'phone-portrait-outline', 'watch-outline',
    'tv-outline', 'camera-outline',
    // Comida y servicios
    'restaurant-outline', 'pizza-outline', 'beer-outline', 'wine-outline',
    'cafe-outline', 'ice-cream-outline', 'fast-food-outline', 'nutrition-outline',
    // Naturaleza
    'leaf-outline', 'flower-outline', 'earth-outline', 'sunny-outline',
    'moon-outline', 'water-outline', 'flame-outline',
    // General
    'star-outline', 'heart-outline', 'flash-outline', 'shield-checkmark-outline',
    'alarm-outline', 'people-outline', 'person-outline', 'settings-outline',
    'cube-outline', 'archive-outline', 'layers-outline', 'lock-closed-outline',
  ];

  // Paleta base: 20 colores ordenados por preferencia visual para cajas de negocio
  private readonly ALL_COLORS: ColorOption[] = [
    { value: '#3880ff', label: 'Azul' },
    { value: '#2dd36f', label: 'Verde' },
    { value: '#eb445a', label: 'Rojo' },
    { value: '#ffc409', label: 'Amarillo' },
    { value: '#5260ff', label: 'Índigo' },
    { value: '#2dd4bf', label: 'Teal' },
    { value: '#f97316', label: 'Naranja' },
    { value: '#a855f7', label: 'Violeta' },
    { value: '#6c757d', label: 'Gris' },
    { value: '#374151', label: 'Oscuro' },
    { value: '#0891b2', label: 'Cian' },
    { value: '#16a34a', label: 'Verde oscuro' },
    { value: '#dc2626', label: 'Rojo oscuro' },
    { value: '#d97706', label: 'Ámbar' },
    { value: '#7c3aed', label: 'Púrpura' },
    { value: '#0f766e', label: 'Esmeralda' },
    { value: '#be185d', label: 'Rosa' },
    { value: '#1d4ed8', label: 'Azul oscuro' },
    { value: '#059669', label: 'Menta' },
    { value: '#92400e', label: 'Marrón' },
  ];

  /** Todos los íconos disponibles (sin los en uso), en orden prioridad: principales primero */
  allIconOptions: IconOption[] = [];
  colorOptions: ColorOption[] = [];

  get iconOptionsVisible(): IconOption[] {
    return this.iconosExpandidos ? this.allIconOptions : this.allIconOptions.slice(0, ICONS_VISIBLE);
  }

  get tieneExtra(): boolean {
    return this.allIconOptions.length > ICONS_VISIBLE;
  }

  constructor() {
    addIcons({
      closeOutline, addCircleOutline, createOutline, chevronDownOutline, chevronUpOutline,
      fileTrayOutline,
      cashOutline, walletOutline, cardOutline, diamondOutline, trophyOutline,
      ribbonOutline, medalOutline,
      storefrontOutline, bagOutline, cartOutline, pricetagOutline, barcodeOutline,
      qrCodeOutline, receiptOutline, ticketOutline, giftOutline, basketOutline,
      businessOutline, homeOutline, libraryOutline, schoolOutline, buildOutline,
      hammerOutline, constructOutline,
      carOutline, busOutline, bicycleOutline, boatOutline, airplaneOutline,
      trainOutline, walkOutline,
      desktopOutline, laptopOutline, phonePortraitOutline, watchOutline,
      tvOutline, cameraOutline,
      restaurantOutline, pizzaOutline, beerOutline, wineOutline, cafeOutline,
      iceCreamOutline, fastFoodOutline, nutritionOutline,
      leafOutline, flowerOutline, earthOutline, sunnyOutline, moonOutline,
      waterOutline, flameOutline,
      starOutline, heartOutline, flashOutline, shieldCheckmarkOutline,
      keyOutline, flagOutline, bookmarkOutline, alarmOutline,
      peopleOutline, personOutline, settingsOutline,
      statsChartOutline, pieChartOutline, analyticsOutline,
      briefcaseOutline, cubeOutline, archiveOutline, layersOutline,
      calculatorOutline, lockClosedOutline,
    });
  }

  /**
   * Devuelve exactamente COLORS_VISIBLE colores únicos no usados.
   * Primero toma de la paleta base; si no alcanza, genera variantes
   * aclarando/oscureciendo los colores base hasta completar el cupo.
   */
  private buildColorOptions(coloresEnUso: Set<string>): ColorOption[] {
    const usados = new Set([...coloresEnUso].map(c => c.toLowerCase()));
    const disponibles = this.ALL_COLORS.filter(o => !usados.has(o.value.toLowerCase()));

    if (disponibles.length >= COLORS_VISIBLE) {
      return disponibles.slice(0, COLORS_VISIBLE);
    }

    // Necesitamos más — generar variantes de los colores base no usados (o todos si faltan)
    const result = [...disponibles];
    const fuente = this.ALL_COLORS.filter(o => !usados.has(o.value.toLowerCase()));
    const pool   = fuente.length > 0 ? fuente : this.ALL_COLORS;
    const usadosResult = new Set(result.map(o => o.value.toLowerCase()));

    const variantes: Array<[number, string]> = [
      [20, 'claro'], [-20, 'oscuro'], [40, 'muy claro'], [-40, 'muy oscuro']
    ];

    for (const [delta, sufijo] of variantes) {
      if (result.length >= COLORS_VISIBLE) break;
      for (const base of pool) {
        if (result.length >= COLORS_VISIBLE) break;
        const variante = this.adjustBrightness(base.value, delta);
        if (!usadosResult.has(variante.toLowerCase()) && !usados.has(variante.toLowerCase())) {
          result.push({ value: variante, label: `${base.label} ${sufijo}` });
          usadosResult.add(variante.toLowerCase());
        }
      }
    }

    return result.slice(0, COLORS_VISIBLE);
  }

  /** Aclara (delta > 0) u oscurece (delta < 0) un color hex */
  private adjustBrightness(hex: string, delta: number): string {
    const n = parseInt(hex.replace('#', ''), 16);
    const clamp = (v: number) => Math.max(0, Math.min(255, v));
    const r = clamp(((n >> 16) & 0xff) + delta);
    const g = clamp(((n >> 8)  & 0xff) + delta);
    const b = clamp((n         & 0xff) + delta);
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  get modoEdicion(): boolean {
    return !!this.cajaEditar;
  }

  ngOnInit() {
    // En modo edición, excluir la caja actual del filtro de "en uso"
    // para que su propio ícono y color aparezcan disponibles en los pickers
    const otrasCAjas = this.cajasExistentes.filter(c => c.id !== this.cajaEditar?.id);
    const iconosEnUso  = new Set(otrasCAjas.map(c => c.icono).filter((v): v is string => !!v));
    const coloresEnUso = new Set(otrasCAjas.map(c => c.color).filter((v): v is string => !!v));

    const allOrdered = [...this.ICONS_MAIN, ...this.ICONS_EXTRA].map(v => ({ value: v }));
    this.allIconOptions = allOrdered.filter(o => !iconosEnUso.has(o.value));
    if (this.allIconOptions.length === 0) this.allIconOptions = [...allOrdered];

    // En modo edición, asegurar que el ícono actual esté en la lista (puede no estar en ICONS_MAIN/EXTRA)
    if (this.cajaEditar?.icono && !this.allIconOptions.find(o => o.value === this.cajaEditar!.icono)) {
      this.allIconOptions.unshift({ value: this.cajaEditar.icono });
    }

    // Si el ícono actual está más allá de los primeros 8, expandir automáticamente
    if (this.cajaEditar?.icono) {
      const idx = this.allIconOptions.findIndex(o => o.value === this.cajaEditar!.icono);
      if (idx >= ICONS_VISIBLE) this.iconosExpandidos = true;
    }

    this.colorOptions = this.buildColorOptions(coloresEnUso);

    const iconoDefault = this.cajaEditar?.icono ?? this.allIconOptions[0].value;
    const colorDefault = this.cajaEditar?.color ?? this.colorOptions[0].value;

    // Asegurar que el color actual aparezca en las opciones (puede ser un hex de BD no en paleta)
    if (this.cajaEditar?.color && !this.colorOptions.find(o => o.value === this.cajaEditar!.color)) {
      this.colorOptions.unshift({ value: this.cajaEditar.color, label: 'Actual' });
      this.colorOptions = this.colorOptions.slice(0, COLORS_VISIBLE);
    }

    this.form = this.fb.group({
      nombre:       [this.cajaEditar?.nombre ?? '', [Validators.required, Validators.minLength(2), Validators.maxLength(50)]],
      icono:        [iconoDefault, Validators.required],
      color:        [colorDefault, Validators.required],
      descripcion:  [this.cajaEditar?.descripcion ?? ''],
      saldoInicial: [0],
    });
  }

  toggleIconos() {
    this.iconosExpandidos = !this.iconosExpandidos;
  }

  seleccionarIcono(valor: string) {
    this.form.patchValue({ icono: valor });
  }

  seleccionarColor(valor: string) {
    this.form.patchValue({ color: valor });
  }

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  async confirmar() {
    if (this.form.invalid || this.guardando) {
      this.form.markAllAsTouched();
      return;
    }

    this.guardando = true;
    try {
      const { nombre, icono, color, descripcion, saldoInicial } = this.form.value;
      // parse(): con type="text" el saldo llega como string (posible coma decimal cruda) — a
      // la BD va el número real. Patrón CLAUDE.md § "Formateo de dinero".
      const saldoNum = this.currency.parse(saldoInicial);

      if (this.modoEdicion) {
        const caja = await this.cajasService.editarCaja(this.cajaEditar!.id, {
          nombre: nombre.trim(), descripcion: descripcion ?? '', icono, color
        });
        if (caja) this.modalCtrl.dismiss(caja, 'confirm');
      } else {
        const caja = await this.cajasService.crearCaja(nombre.trim(), icono, color, descripcion ?? '', saldoNum);
        if (caja) this.modalCtrl.dismiss(caja, 'confirm');
      }
    } finally {
      this.guardando = false;
    }
  }
}
