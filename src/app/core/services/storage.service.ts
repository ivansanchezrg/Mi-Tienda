import { Injectable, inject } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { ModalController } from '@ionic/angular/standalone';
import { SupabaseService } from './supabase.service';
import { AuthService } from '../../features/auth/services/auth.service';
import { UiService } from './ui.service';
import { LoggerService } from './logger.service';
import { NetworkService } from './network.service';
import { ImagenLocalService } from './imagen-local.service';
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
  private network     = inject(NetworkService);
  private imagenLocal = inject(ImagenLocalService);

  // Cache de URLs firmadas por path crudo de Storage.
  // El path es estable entre categorías/búsquedas → una imagen se firma UNA vez (online)
  // y se reutiliza en todo render posterior, incluso offline. La signed URL expira a la hora
  // (expiresIn de getSignedUrl); se reusa solo dentro de un margen seguro antes de caducar.
  private static readonly SIGNED_URL_REUSE_MS = 50 * 60 * 1000; // 50 min (TTL real: 60 min)
  private signedUrlCache = new Map<string, { url: string; firmadaEn: number }>();
  // Dedup de firmas en vuelo: N resoluciones simultáneas del mismo path (p.ej. la imagen
  // del template compartida por todas sus variantes en el burst inicial del catálogo)
  // esperan la MISMA promesa en vez de disparar N createSignedUrl paralelos.
  private signedUrlInflight = new Map<string, Promise<string | null>>();

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
      // Si la app se reanuda tras estar en background/reposo (el proceso murió y el
      // access token expiró), refreshSessionOnResume() corre en paralelo con el
      // arranque. createSignedUrl() no pasa por SupabaseService.call() —a diferencia
      // de toda otra query del proyecto— así que sin esto sale con el JWT viejo,
      // Supabase responde error de auth y esta imagen queda en null hasta el próximo
      // refresco manual del catálogo (bug reportado: fotos del POS en blanco tras
      // reabrir la app en reposo). Mismo wait que ya hace call() en supabase.service.ts.
      if (this.supabase.resumeRefreshInFlight) {
        await this.supabase.resumeRefreshInFlight;
      }

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

  // Resuelve el path de Storage a una URL mostrable por <img>.
  // Si ya es una URL completa (http/https) la retorna tal cual — evita doble resolución.
  //
  // Estrategia de resolución (en orden):
  //   1. Binario local en disco (ImagenLocalService): la fuente más robusta offline —
  //      sobrevive cold start y días sin red. Se prioriza siempre que exista.
  //   2. signed URL cacheada en RAM: rápida, pero muere con el proceso y expira a 60 min.
  //   3. Online: firmar contra Supabase + disparar la descarga del binario en background
  //      para que la PRÓXIMA vez (aunque sea offline tras un cold start) la foto esté local.
  //   4. Offline sin binario ni cache RAM: null (placeholder) — no hay forma de mostrarla.
  async resolveImageUrl(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    if (path.startsWith('http')) return path;

    const offline = !this.network.isConnected();

    // 1. Binario persistido en disco — sobrevive cold start + días sin red.
    const local = await this.imagenLocal.obtenerLocal(path);
    if (local) return local;

    // 2. signed URL cacheada en RAM (misma sesión de proceso).
    const cached = this.signedUrlCache.get(path);
    if (cached) {
      const fresca = Date.now() - cached.firmadaEn < StorageService.SIGNED_URL_REUSE_MS;
      // Online: reusar solo si está fresca. Offline: reusar siempre (no hay forma de re-firmar).
      if (fresca || offline) return cached.url;
    }

    if (offline) return null;

    // 3. Online: firmar para este render + descargar el binario en background para el
    //    offline futuro. Con dedup en vuelo: si otro render ya está firmando este mismo
    //    path, se reutiliza su promesa.
    const enVuelo = this.signedUrlInflight.get(path);
    if (enVuelo) return enVuelo;

    const firma = (async () => {
      try {
        const url = await this.getSignedUrl(path);
        if (url) {
          this.signedUrlCache.set(path, { url, firmadaEn: Date.now() });
          void this.imagenLocal.descargar(path); // best-effort, no bloquea el render
        }
        return url;
      } finally {
        this.signedUrlInflight.delete(path);
      }
    })();
    this.signedUrlInflight.set(path, firma);
    return firma;
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

  // Borra TODO el contenido de un negocio en el bucket — uso exclusivo del flujo
  // de purga (PLAN-BORRADO-AUTOMATICO-NEGOCIOS.md, Fase 4). No se llama desde el
  // guard ni desde ninguna página normal de la app — no exponer en menús de usuario.
  //
  // Recorre recursivamente {negocioId}/ sin hardcodear nombres de subcarpeta
  // (comprobantes/, productos/, etc.): list() de Supabase Storage no es recursivo,
  // así que cada entrada sin metadata.size (carpeta) se vuelve a listar, y cada
  // entrada con metadata.size (archivo) se acumula para el remove() final.
  // Hardcodear subcarpetas es frágil — un subfolder nuevo agregado a futuro
  // (ej. notas/adjuntos) quedaría huérfano si este método no se actualiza a mano.
  async deleteNegocioFolder(negocioId: string): Promise<void> {
    const paths = await this.listarArchivosRecursivo(negocioId);
    if (paths.length === 0) return;

    // remove() acepta un array — se borra en un solo lote, sin límite documentado
    // bajo (Supabase soporta cientos por llamada); si algún negocio tuviera miles
    // de archivos, dividir en chunks no es necesario hoy (negocio promedio: decenas).
    const { error } = await this.supabase.client.storage.from(BUCKET).remove(paths);
    if (error) {
      this.logger.error('StorageService', `Error al purgar carpeta de negocio ${negocioId}`, error);
      throw error;
    }
  }

  private async listarArchivosRecursivo(prefix: string): Promise<string[]> {
    const { data, error } = await this.supabase.client.storage.from(BUCKET).list(prefix);
    if (error) {
      this.logger.error('StorageService', `Error al listar ${prefix}`, error);
      return [];
    }
    if (!data) return [];

    const archivos: string[] = [];
    for (const entry of data) {
      const entryPath = `${prefix}/${entry.name}`;
      // Una carpeta no tiene metadata.size (id es null) en la respuesta de Storage;
      // un archivo real sí lo tiene.
      if (entry.id === null) {
        archivos.push(...await this.listarArchivosRecursivo(entryPath));
      } else {
        archivos.push(entryPath);
      }
    }
    return archivos;
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
