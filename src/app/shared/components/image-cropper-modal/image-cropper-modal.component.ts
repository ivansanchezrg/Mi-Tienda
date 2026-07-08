import { Component, Input, OnInit, OnDestroy, ViewChild, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonIcon, IonSpinner, ModalController } from '@ionic/angular/standalone';
import { ImageCropperComponent, LoadedImage, ImageTransform } from 'ngx-image-cropper';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style, StatusBarInfo } from '@capacitor/status-bar';
import { addIcons } from 'ionicons';
import { closeOutline, refreshOutline, returnUpBackOutline } from 'ionicons/icons';

export interface ImageCropperResult {
  croppedBlob: Blob;
}

export type AspectRatioPreset = 'libre' | 'cuadrado' | '4:3' | '16:9' | '3:4';

type ToolTab = 'rotar' | 'escalar';

@Component({
  selector: 'app-image-cropper-modal',
  templateUrl: './image-cropper-modal.component.html',
  styleUrls: ['./image-cropper-modal.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonIcon,
    IonSpinner,
    ImageCropperComponent,
  ],
})
export class ImageCropperModalComponent implements OnInit, OnDestroy {
  @Input({ required: true }) imageUrl!: string;
  @Input() initialRatio: AspectRatioPreset = 'libre';
  @Input() lockRatio = true;

  private modalCtrl = inject(ModalController);

  /** Referencia al cropper para recortar imperativamente al confirmar */
  @ViewChild(ImageCropperComponent) private cropperCmp?: ImageCropperComponent;

  // ── Estado de imagen ──────────────────────────────────────────────────────
  imageSource    = signal<string | null>(null);
  imageLoaded    = signal(false);
  cropError      = signal(false);

  /** true mientras se genera el blob del recorte al confirmar (encode lento en Android) */
  procesando = signal(false);

  canConfirm = computed(() => this.imageLoaded() && !this.procesando());

  // ── Herramientas ──────────────────────────────────────────────────────────
  toolTab = signal<ToolTab>('rotar');

  /** Rotación en grados: -45 a 45 (slider fino) */
  rotacionGrados = signal(0);

  /** Escala: 1.0 = 100%, rango 0.5–3.0 */
  escala = signal(1.0);

  /** Rotación en pasos de 90° acumulados */
  private rotacion90 = signal(0);

  /** Transform compuesto que se pasa al cropper */
  transform = computed<ImageTransform>(() => {
    const totalDeg = this.rotacionGrados() + this.rotacion90() * 90;
    return {
      rotate: totalDeg,
      scale:  this.escala(),
    };
  });

  get rotacionLabel(): string {
    const v = this.rotacionGrados();
    return v === 0 ? '0°' : (v > 0 ? `+${v}°` : `${v}°`);
  }

  get escalaLabel(): string {
    return `${Math.round(this.escala() * 100)}%`;
  }

  // ── Slider binding helpers (ngModel necesita get/set) ─────────────────────
  get rotacionValue(): number { return this.rotacionGrados(); }
  set rotacionValue(v: number) { this.rotacionGrados.set(v); }

  get escalaValue(): number { return this.escala(); }
  set escalaValue(v: number) { this.escala.set(v); }

  // ── Aspect ratio ──────────────────────────────────────────────────────────
  ratioActual = signal<AspectRatioPreset>('libre');

  currentAspectRatio = computed<number>(() => {
    const map: Record<AspectRatioPreset, number> = {
      'libre':   0,
      'cuadrado': 1,
      '4:3':     4 / 3,
      '3:4':     3 / 4,
      '16:9':    16 / 9,
    };
    return map[this.ratioActual()] ?? 0;
  });

  // ── Internos ──────────────────────────────────────────────────────────────
  private blobUrlsCreadas: string[] = [];
  private statusBarOriginal: StatusBarInfo | null = null;

  constructor() {
    addIcons({ closeOutline, refreshOutline, returnUpBackOutline });
  }

  async ngOnInit() {
    this.ratioActual.set(this.initialRatio);
    await this.aplicarStatusBarOscura();
    await this.resolveImageSource();
  }

  async ngOnDestroy() {
    for (const url of this.blobUrlsCreadas) URL.revokeObjectURL(url);
    this.blobUrlsCreadas = [];
    await this.restaurarStatusBar();
  }

  // ── Callbacks cropper ─────────────────────────────────────────────────────

  onImageLoaded(_event: LoadedImage) {
    this.imageLoaded.set(true);
  }

  onLoadImageFailed() {
    this.cropError.set(true);
    this.imageLoaded.set(false);
  }

  // ── Acciones de herramientas ──────────────────────────────────────────────

  rotar90() {
    this.rotacion90.update(v => v + 1);
  }

  resetRotacion() {
    this.rotacionGrados.set(0);
    this.rotacion90.set(0);
  }

  resetEscala() {
    this.escala.set(1.0);
  }

  setToolTab(tab: ToolTab) {
    this.toolTab.set(tab);
  }

  // ── Acciones del modal ────────────────────────────────────────────────────

  cancelar() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  /**
   * Genera el recorte EN el momento de confirmar, con la posición actual del
   * recuadro, y recién entonces cierra el modal.
   *
   * Por qué imperativo y no (imageCropped) + autoCrop: el autoCrop de la librería
   * genera el blob de forma asíncrona al terminar cada gesto (canvas + encode PNG,
   * 0.5–1.5s en Android). Si el usuario confirmaba antes de que terminara, se
   * despachaba el blob VIEJO — típicamente el inicial de la imagen completa —
   * y la foto se guardaba sin recortar. Solo "funcionaba" si después de mover
   * las esquinas también arrastraba el recuadro (ese gesto extra le daba tiempo
   * al encode). En web nunca se notó porque el encode tarda ~50ms.
   * crop('blob') usa la posición y transform actuales — inmune al timing.
   */
  async confirmar() {
    if (this.procesando() || !this.imageLoaded() || !this.cropperCmp) return;
    this.procesando.set(true);
    try {
      const resultado = await this.cropperCmp.crop('blob');
      if (resultado?.blob) {
        this.modalCtrl.dismiss({ croppedBlob: resultado.blob } as ImageCropperResult, 'confirm');
      }
    } finally {
      this.procesando.set(false);
    }
  }

  // ── Privados ──────────────────────────────────────────────────────────────

  private async aplicarStatusBarOscura(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      this.statusBarOriginal = await StatusBar.getInfo();
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: '#000000' });
    } catch { /* ignorar */ }
  }

  private async restaurarStatusBar(): Promise<void> {
    if (!Capacitor.isNativePlatform() || !this.statusBarOriginal) return;
    try {
      await StatusBar.setStyle({ style: this.statusBarOriginal.style });
      if (this.statusBarOriginal.color) {
        await StatusBar.setBackgroundColor({ color: this.statusBarOriginal.color });
      }
    } catch { /* ignorar */ }
  }

  private async resolveImageSource(): Promise<void> {
    const url = this.imageUrl;
    if (!url) { this.cropError.set(true); return; }

    if (url.startsWith('data:') || url.startsWith('blob:')) {
      this.imageSource.set(url);
      return;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('fetch failed');
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      this.blobUrlsCreadas.push(blobUrl);
      this.imageSource.set(blobUrl);
    } catch {
      this.cropError.set(true);
    }
  }
}
