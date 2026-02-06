import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

@Injectable({
  providedIn: 'root'
})
export class StorageService {
  private supabase = inject(SupabaseService);

  /**
   * Sube una imagen a Supabase Storage
   * @param dataUrl - DataURL de la imagen (desde Camera.getPhoto)
   * @param bucket - Nombre del bucket ('comprobantes')
   * @returns Path del archivo en Storage o null si falla
   */
  async uploadImage(dataUrl: string, bucket: string = 'comprobantes'): Promise<string | null> {
    try {
      // 1. Convertir DataURL a Blob
      const blob = this.dataURLtoBlob(dataUrl);

      // 2. Generar nombre único con estructura de carpetas por fecha
      const fileName = this.generateFileName();

      // 3. Subir a Supabase Storage
      const { data, error } = await this.supabase.client.storage
        .from(bucket)
        .upload(fileName, blob, {
          contentType: 'image/jpeg',
          upsert: false
        });

      if (error) {
        console.error('Error al subir imagen:', error);
        return null;
      }

      // 4. Retornar el path del archivo
      return data.path;
    } catch (error) {
      console.error('Error en uploadImage:', error);
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
   * Convierte DataURL a Blob
   */
  private dataURLtoBlob(dataUrl: string): Blob {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)![1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }

  /**
   * Genera nombre único para archivo con estructura de carpetas por fecha
   * Formato: YYYY/MM/{uuid}.jpg
   */
  private generateFileName(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const uuid = crypto.randomUUID();

    return `${year}/${month}/${uuid}.jpg`;
  }
}
