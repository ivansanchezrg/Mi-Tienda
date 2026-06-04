import { Injectable, inject } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { ModalController } from '@ionic/angular/standalone';
import { SupabaseService } from './supabase.service';
import { AuthService } from '../../features/auth/services/auth.service';
import { UiService } from './ui.service';
import { LoggerService } from './logger.service';
import { getFechaLocal } from '../utils/date.util';
import { OptionsModalComponent, ModalOptionGroup } from '../../shared/components/options-modal/options-modal.component';
import { ImageCropperModalComponent, ImageCropperResult, AspectRatioPreset } from '../../shared/components/image-cropper-modal/image-cropper-modal.component';

// Bucket único para toda la app. Estructura interna:
// mi-tienda/{negocio_id}/comprobantes/YYYY/MM/operaciones/{uuid}.webp
// mi-tienda/{negocio_id}/productos/{subfolder}/{uuid}.webp
const BUCKET = 'mi-tienda';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private supabase    = inject(SupabaseService);
  private auth        = inject(AuthService);
  private ui          = inject(UiService);
  private logger      = inject(LoggerService);
  private sanitizer   = inject(DomSanitizer);
  private modalCtrl   = inject(ModalController);

  // true en Android/iOS, false en browser/desktop
  get isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  async capturarFoto(source: CameraSource): Promise<{ previewUrl: SafeUrl; rawUrl: string } | null> {
    try {
      const photo = await Camera.getPhoto({
        // Captura de alta calidad — el resultado final se re-comprime al subir.
        // 1920px da margen para que el recorte (1:1 → ~1200px) no se degrade,
        // y quality:92 evita el artefacto JPEG de la cámara antes del cropper.
        quality: 92,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source,
        width: 1920,
        height: 1920,
        correctOrientation: true,
        saveToGallery: false
      });

      let rawUrl: string;

      if (Capacitor.isNativePlatform() && photo.path) {
        // convertFileSrc: convierte file:///... a capacitor://localhost/...
        // Angular bloquea capacitor:// en [src] — necesita bypassSecurityTrustUrl.
        rawUrl = Capacitor.convertFileSrc(photo.path);
      } else {
        rawUrl = photo.webPath ?? '';
      }

      if (!rawUrl) return null;

      return {
        previewUrl: this.sanitizer.bypassSecurityTrustUrl(rawUrl),
        rawUrl
      };
    } catch (err: any) {
      const msg: string = (err?.message ?? '').toLowerCase();
      if (msg.includes('cancel') || msg.includes('no image') || msg.includes('user denied')) {
        return null;
      }
      this.logger.error('StorageService', 'Error al capturar foto', err);
      return null;
    }
  }

  /**
   * Flujo completo de selección de imagen con recorte:
   *  1. Elige la fuente (cámara o galería)
   *  2. Abre el cropper para que el usuario ajuste el encuadre
   *  3. Retorna el recorte listo para pasar a uploadImage()
   *
   * @param initialRatio  Proporción inicial del cropper (default: 'cuadrado' — ideal para catálogo)
   * @param lockRatio     Si true, el usuario no puede cambiar la proporción
   * @param withCrop      Si false, salta el cropper y devuelve la foto directa (para comprobantes)
   */
  async elegirFuenteFoto(
    initialRatio: AspectRatioPreset = 'libre',
    lockRatio = true,
    withCrop = true,
  ): Promise<{ previewUrl: SafeUrl; rawUrl: string } | null> {

    // ── 1. Elegir fuente ──────────────────────────────────────────────────
    let fotoRaw: { previewUrl: SafeUrl; rawUrl: string } | null;

    if (!this.isNative) {
      fotoRaw = await this.capturarFoto(CameraSource.Photos);
    } else {
      const groups: ModalOptionGroup[] = [{
        options: [
          { label: 'Tomar foto',        icon: 'camera-outline', value: 'camera'  },
          { label: 'Elegir de galería', icon: 'images-outline', value: 'gallery' },
        ]
      }];
      const picker = await this.modalCtrl.create({
        component: OptionsModalComponent,
        componentProps: { title: 'Agregar imagen', groups },
        cssClass: 'options-modal',
        breakpoints: [0, 1],
        initialBreakpoint: 1,
      });
      await picker.present();
      const { data: fuente } = await picker.onDidDismiss<string>();
      if (!fuente) return null;

      const source = fuente === 'camera' ? CameraSource.Camera : CameraSource.Photos;
      fotoRaw = await this.capturarFoto(source);
    }

    if (!fotoRaw) return null;

    // ── 2. Cropper (omitido para comprobantes y contextos sin crop) ───────
    if (!withCrop) return fotoRaw;

    return this.abrirCropperConUrl(fotoRaw.rawUrl, initialRatio, lockRatio);
  }

  /**
   * Abre el cropper directamente sobre una imagen existente — sin pasar por la cámara/galería.
   * Útil cuando el usuario quiere ajustar el recorte de una foto ya capturada o ya guardada en BD.
   *
   * Acepta:
   *  - base64 (data:image/...)
   *  - signed URL del bucket (https://...)
   *  - blob: o capacitor:// URLs
   *
   * @param imageUrl     URL de la imagen actual
   * @param initialRatio Proporción inicial (default: 'cuadrado')
   * @param lockRatio    Si true, no se puede cambiar la proporción
   */
  async recortarImagen(
    imageUrl: string,
    initialRatio: AspectRatioPreset = 'libre',
    lockRatio = true,
  ): Promise<{ previewUrl: SafeUrl; rawUrl: string } | null> {
    if (!imageUrl) return null;
    return this.abrirCropperConUrl(imageUrl, initialRatio, lockRatio);
  }

  /**
   * Abre el cropper modal y convierte el blob resultante a un blob: URL local
   * + SafeUrl para preview. El blob: URL es eficiente (no se serializa) y
   * compressImage lo decodifica directamente vía fetch sin pasar por data URL.
   * El blob: URL se libera cuando uploadImage termina o cuando el caller
   * llama removerFoto() — pero como el caller suele reemplazar el rawUrl al
   * siguiente cambio de foto, no es crítico mantener tracking aquí.
   */
  private async abrirCropperConUrl(
    imageUrl: string,
    initialRatio: AspectRatioPreset,
    lockRatio: boolean,
  ): Promise<{ previewUrl: SafeUrl; rawUrl: string } | null> {
    const cropModal = await this.modalCtrl.create({
      component: ImageCropperModalComponent,
      componentProps: { imageUrl, initialRatio, lockRatio },
      cssClass: 'image-cropper-modal',
    });
    await cropModal.present();
    const { data: cropResult, role } = await cropModal.onDidDismiss<ImageCropperResult>();

    if (role !== 'confirm' || !cropResult) return null;

    const blobUrl = URL.createObjectURL(cropResult.croppedBlob);
    return {
      previewUrl: this.sanitizer.bypassSecurityTrustUrl(blobUrl),
      rawUrl:     blobUrl,
    };
  }

  /**
   * Abre el menú de opciones para una imagen ya seleccionada en el formulario.
   * Devuelve la acción elegida por el usuario para que el caller decida qué hacer:
   *  - 'recortar' → re-cropear la imagen actual (usar recortarImagen())
   *  - 'cambiar'  → reemplazar por una foto nueva (usar elegirFuenteFoto())
   *  - 'quitar'   → eliminar la imagen
   *  - null       → el usuario cerró el menú
   *
   * Este helper centraliza el patrón de menú de imagen para mantener consistencia
   * entre módulos (producto-info-form, presentacion-modal, etc.).
   */
  async mostrarOpcionesImagen(): Promise<'recortar' | 'cambiar' | 'quitar' | null> {
    const groups: ModalOptionGroup[] = [{
      options: [
        { label: 'Recortar de nuevo', icon: 'crop-outline',    value: 'recortar' },
        { label: 'Cambiar imagen',    icon: 'camera-outline',  value: 'cambiar'  },
        { label: 'Quitar imagen',     icon: 'trash-outline',   value: 'quitar', color: 'danger' },
      ]
    }];
    const modal = await this.modalCtrl.create({
      component: OptionsModalComponent,
      componentProps: { title: 'Imagen', groups },
      cssClass: 'options-modal',
      breakpoints: [0, 1],
      initialBreakpoint: 1,
    });
    await modal.present();
    const { data } = await modal.onDidDismiss<'recortar' | 'cambiar' | 'quitar'>();
    return data ?? null;
  }

  async uploadImage(imageUrl: string, subfolder: string = 'general', useDatePrefix = true): Promise<string | null> {
    const negocioId = this.auth.usuarioActualValue?.negocio_id;
    if (!negocioId) {
      this.logger.error('StorageService', 'uploadImage sin negocio_id — usuario no autenticado');
      return null;
    }

    try {
      const { blob, ext, mime } = await this.compressImage(imageUrl);
      const fileName = this.buildPath(negocioId, subfolder, ext, useDatePrefix);

      const { data, error } = await this.supabase.client.storage
        .from(BUCKET)
        .upload(fileName, blob, { contentType: mime, upsert: false });

      if (error) {
        this.logger.error('StorageService', 'Error al subir imagen', error);
        this.handleStorageError(error);
        return null;
      }

      return data.path;
    } catch (error) {
      this.logger.error('StorageService', 'Error en uploadImage', error);
      this.handleStorageError(error);
      return null;
    }
  }

  async getSignedUrl(path: string, expiresIn: number = 3600): Promise<string | null> {
    try {
      const { data, error } = await this.supabase.client.storage
        .from(BUCKET)
        .createSignedUrl(path, expiresIn);

      if (error) {
        this.logger.error('StorageService', 'Error al crear URL firmada', error);
        return null;
      }

      return data.signedUrl;
    } catch (error) {
      this.logger.error('StorageService', 'Error en getSignedUrl', error);
      return null;
    }
  }

  getPublicUrl(path: string): string | null {
    try {
      const { data } = this.supabase.client.storage
        .from(BUCKET)
        .getPublicUrl(path);

      return data.publicUrl;
    } catch (error) {
      this.logger.error('StorageService', 'Error al obtener URL pública', error);
      return null;
    }
  }

  // Resuelve el path de Storage a una URL firmada válida.
  // Si ya es una URL completa (http/https) la retorna tal cual — evita doble resolución.
  async resolveImageUrl(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    if (path.startsWith('http')) return path;
    return this.getSignedUrl(path);
  }

  // Resuelve múltiples paths en paralelo — usar cuando se carga una lista de productos.
  async resolveImageUrls(paths: (string | null | undefined)[]): Promise<(string | null)[]> {
    return Promise.all(paths.map(p => this.resolveImageUrl(p)));
  }

  // Upload nueva imagen y elimina la anterior atómicamente desde el cliente.
  // Si el upload falla retorna null y no toca oldPath.
  // Si el delete de oldPath falla la nueva imagen ya está guardada — se loguea pero no revierte.
  async replaceImage(newImageUrl: string, subfolder: string, oldPath: string | null, useDatePrefix = true): Promise<string | null> {
    const newPath = await this.uploadImage(newImageUrl, subfolder, useDatePrefix);
    if (!newPath) return null;
    if (oldPath) await this.deleteFile(oldPath);
    return newPath;
  }

  async deleteFile(path: string): Promise<boolean> {
    try {
      const { error } = await this.supabase.client.storage
        .from(BUCKET)
        .remove([path]);

      if (error) {
        this.logger.error('StorageService', 'Error al eliminar archivo', error);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('StorageService', 'Error en deleteFile', error);
      return false;
    }
  }

  private buildPath(negocioId: string, subfolder: string, ext: string, useDatePrefix: boolean): string {
    if (useDatePrefix) {
      const [year, month] = getFechaLocal().split('-');
      return `${negocioId}/${subfolder}/${year}/${month}/${crypto.randomUUID()}.${ext}`;
    }
    return `${negocioId}/${subfolder}/${crypto.randomUUID()}.${ext}`;
  }

  private handleStorageError(error: any): void {
    const message = error?.message || error?.toString() || '';

    if (message.includes('exp') && message.includes('claim')) {
      this.ui.showToast('Tu sesión expiró. Cierra sesión e inicia de nuevo.', 'warning');
    } else if (message.includes('Bucket not found')) {
      this.ui.showToast('Almacenamiento no configurado. Contacta al administrador.', 'danger');
    } else if (message.includes('maximum allowed size') || message.includes('exceeded')) {
      this.ui.showToast('La imagen es demasiado grande. Intenta con una foto más pequeña.', 'warning');
    } else if (message.includes('not allowed') || message.includes('security policy')) {
      this.ui.showToast('No tienes permisos para subir archivos.', 'danger');
    }
  }

  private async compressImage(imageUrl: string): Promise<{ blob: Blob; ext: string; mime: string }> {
    // Para data: y blob: el <img> los carga directo — no necesitamos fetch.
    // Para capacitor:// y http(s) hacemos fetch y creamos un blob: URL temporal
    // que se revoca tras el decode (más eficiente que data URL gigante en memoria).
    let srcForCanvas = imageUrl;
    let tempBlobUrl: string | null = null;

    if (!imageUrl.startsWith('data:') && !imageUrl.startsWith('blob:')) {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      tempBlobUrl = URL.createObjectURL(blob);
      srcForCanvas = tempBlobUrl;
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      const cleanup = () => { if (tempBlobUrl) URL.revokeObjectURL(tempBlobUrl); };
      img.onload = () => {
        // 1600px es el tope para mantener detalle en el catálogo (el cropper ya
        // entrega a 1600px máx; si la imagen original era menor no se escala).
        const MAX_SIDE = 1600;
        let { width, height } = img;

        if (width > height && width > MAX_SIDE) {
          height = Math.round(height * MAX_SIDE / width);
          width = MAX_SIDE;
        } else if (height > MAX_SIDE) {
          width = Math.round(width * MAX_SIDE / height);
          height = MAX_SIDE;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas no soportado')); return; }

        // Mejor calidad de escalado al hacer downscale grande
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Calidad 0.92: balance entre tamaño (~150-400 KB) y nitidez visible.
        // Bajar de 0.85 produce artefactos visibles sobre el recorte del cropper.
        canvas.toBlob(
          blob => {
            cleanup();
            if (blob && blob.size > 0) {
              resolve({ blob, ext: 'webp', mime: 'image/webp' });
            } else {
              canvas.toBlob(
                jpegBlob => {
                  if (jpegBlob) resolve({ blob: jpegBlob, ext: 'jpg', mime: 'image/jpeg' });
                  else reject(new Error('Error al comprimir imagen'));
                },
                'image/jpeg', 0.92
              );
            }
          },
          'image/webp', 0.92
        );
      };
      img.onerror = () => { cleanup(); reject(new Error('No se pudo cargar la imagen')); };
      img.src = srcForCanvas;
    });
  }
}
