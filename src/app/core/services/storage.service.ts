import { Injectable, inject } from '@angular/core';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from '../../features/auth/services/auth.service';
import { UiService } from './ui.service';
import { LoggerService } from './logger.service';
import { getFechaLocal } from '../utils/date.util';

// Bucket único para toda la app. Estructura interna:
// mi-tienda/{negocio_id}/comprobantes/YYYY/MM/operaciones/{uuid}.webp
// mi-tienda/{negocio_id}/productos/{subfolder}/{uuid}.webp
const BUCKET = 'mi-tienda';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private supabase = inject(SupabaseService);
  private auth = inject(AuthService);
  private ui = inject(UiService);
  private logger = inject(LoggerService);
  private sanitizer = inject(DomSanitizer);

  // true en Android/iOS, false en browser/desktop
  get isNative(): boolean {
    return Capacitor.isNativePlatform();
  }

  async capturarFoto(source: CameraSource): Promise<{ previewUrl: SafeUrl; rawUrl: string } | null> {
    try {
      const photo = await Camera.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source,
        width: 1280,
        height: 1280,
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
    let srcForCanvas = imageUrl;
    if (!imageUrl.startsWith('data:')) {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      srcForCanvas = await this.blobToDataUrl(blob);
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const MAX_SIDE = 1200;
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
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          blob => {
            if (blob && blob.size > 0) {
              resolve({ blob, ext: 'webp', mime: 'image/webp' });
            } else {
              canvas.toBlob(
                jpegBlob => {
                  if (jpegBlob) resolve({ blob: jpegBlob, ext: 'jpg', mime: 'image/jpeg' });
                  else reject(new Error('Error al comprimir imagen'));
                },
                'image/jpeg', 0.8
              );
            }
          },
          'image/webp', 0.8
        );
      };
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
      img.src = srcForCanvas;
    });
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Error al leer blob'));
      reader.readAsDataURL(blob);
    });
  }
}
