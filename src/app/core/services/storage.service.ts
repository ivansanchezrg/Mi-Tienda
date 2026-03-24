import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { UiService } from './ui.service';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private supabase = inject(SupabaseService);
  private ui = inject(UiService);

  /**
   * Sube una imagen a Supabase Storage.
   * @param dataUrl   - DataURL de la imagen (desde Camera.getPhoto)
   * @param bucket    - Nombre del bucket (default: 'comprobantes')
   * @param subfolder - Carpeta dentro de YYYY/MM/ que identifica el tipo.
   *                    Valores actuales: 'operaciones' | 'gastos'
   *                    Resultado: comprobantes/YYYY/MM/{subfolder}/{uuid}.jpg
   * @returns Path del archivo en Storage o null si falla
   */
  async uploadImage(dataUrl: string, bucket: string = 'comprobantes', subfolder: string = 'general', useDatePrefix = true): Promise<string | null> {
    try {
      // 1. Comprimir imagen si supera el límite (5 MB)
      const compressed = await this.compressImage(dataUrl);

      // 2. Convertir a Blob
      const blob = this.dataURLtoBlob(compressed);

      // 3. Generar nombre único
      const fileName = useDatePrefix
        ? this.generateFileName(subfolder)
        : `${subfolder}/${crypto.randomUUID()}.jpg`;

      // 4. Subir a Supabase Storage
      const { data, error } = await this.supabase.client.storage
        .from(bucket)
        .upload(fileName, blob, {
          contentType: 'image/jpeg',
          upsert: false
        });

      if (error) {
        console.error('Error al subir imagen:', error);
        this.handleStorageError(error);
        return null;
      }

      // 5. Retornar el path del archivo
      return data.path;
    } catch (error) {
      console.error('Error en uploadImage:', error);
      this.handleStorageError(error);
      return null;
    }
  }

  /**
   * Obtiene una URL firmada (signed URL) de un archivo privado
   * @param path - Path del archivo en Storage
   * @param bucket - Nombre del bucket
   * @param expiresIn - Tiempo de expiración en segundos (default: 1 hora)
   * @returns URL firmada o null si falla
   */
  async getSignedUrl(path: string, bucket: string = 'comprobantes', expiresIn: number = 3600): Promise<string | null> {
    try {
      const { data, error } = await this.supabase.client.storage
        .from(bucket)
        .createSignedUrl(path, expiresIn);

      if (error) {
        console.error('Error al crear URL firmada:', error);
        return null;
      }

      return data.signedUrl;
    } catch (error) {
      console.error('Error en getSignedUrl:', error);
      return null;
    }
  }

  /**
   * Obtiene la URL pública de un archivo (solo para buckets públicos)
   * @param path - Path del archivo en Storage
   * @param bucket - Nombre del bucket
   * @returns URL pública o null si falla
   */
  getPublicUrl(path: string, bucket: string = 'comprobantes'): string | null {
    try {
      const { data } = this.supabase.client.storage
        .from(bucket)
        .getPublicUrl(path);

      return data.publicUrl;
    } catch (error) {
      console.error('Error al obtener URL pública:', error);
      return null;
    }
  }

  /**
   * Elimina un archivo de Storage
   * @param path - Path del archivo
   * @param bucket - Nombre del bucket
   */
  async deleteFile(path: string, bucket: string = 'comprobantes'): Promise<boolean> {
    try {
      const { error } = await this.supabase.client.storage
        .from(bucket)
        .remove([path]);

      if (error) {
        console.error('Error al eliminar archivo:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error en deleteFile:', error);
      return false;
    }
  }

  /**
   * Detecta errores comunes de Storage y muestra toast descriptivo
   */
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

  /**
   * Comprime una imagen DataURL usando canvas.
   * Redimensiona a máximo 1200x1600 y reduce calidad JPEG progresivamente
   * hasta que el resultado pese menos de maxSizeBytes (default 5 MB).
   */
  private async compressImage(dataUrl: string, maxSizeBytes = 5 * 1024 * 1024): Promise<string> {
    // Si ya es menor al límite, devolver tal cual
    const estimatedSize = Math.round((dataUrl.length * 3) / 4);
    if (estimatedSize <= maxSizeBytes) return dataUrl;

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const MAX_WIDTH = 1200;
        const MAX_HEIGHT = 1600;

        let { width, height } = img;
        if (width > MAX_WIDTH || height > MAX_HEIGHT) {
          const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);

        // Reducir calidad progresivamente: 0.7 → 0.5 → 0.3
        for (const quality of [0.7, 0.5, 0.3]) {
          const result = canvas.toDataURL('image/jpeg', quality);
          const size = Math.round((result.length * 3) / 4);
          if (size <= maxSizeBytes) {
            resolve(result);
            return;
          }
        }

        // Si aún es muy grande con quality 0.3, devolver igual (el servidor rechazará)
        resolve(canvas.toDataURL('image/jpeg', 0.3));
      };
      img.onerror = () => reject(new Error('No se pudo cargar la imagen para comprimir'));
      img.src = dataUrl;
    });
  }

  /**
   * Convierte DataURL a Blob
   */
  private dataURLtoBlob(dataUrl: string): Blob {
    const arr = dataUrl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || arr.length < 2) {
      throw new Error('Formato de imagen inválido. Se esperaba un DataURL válido.');
    }
    const mime = mimeMatch[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }

  /**
   * Genera nombre único para archivo con estructura de carpetas por fecha y tipo
   * Formato: YYYY/MM/{subfolder}/{uuid}.jpg
   */
  private generateFileName(subfolder: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const uuid = crypto.randomUUID();

    return `${year}/${month}/${subfolder}/${uuid}.jpg`;
  }
}
