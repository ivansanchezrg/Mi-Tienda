import { Injectable } from '@angular/core';

/**
 * Servicio centralizado para abrir chats de WhatsApp con mensaje precargado.
 * Gestiona la normalización del teléfono al formato internacional Ecuador
 * (593...) que exige api.whatsapp.com, y la construcción de la URL final.
 *
 * Uso:
 *   private whatsapp = inject(WhatsAppService);
 *   this.whatsapp.abrir('0991234567', ['Hola', 'Línea 2']);
 *
 * El caller arma las líneas del mensaje — este servicio solo normaliza el
 * teléfono, une las líneas con \n y abre la URL.
 */
@Injectable({ providedIn: 'root' })
export class WhatsAppService {

  /** Normaliza un teléfono al formato 593XXXXXXXXX que exige api.whatsapp.com.
   *  Acepta: '0991234567', '+593991234567', '593991234567', etc.
   *  Devuelve '' si el input es vacío o solo contiene no-numéricos. */
  normalizarTelefono(tel: string): string {
    if (!tel) return '';
    let t = tel.replace(/\D/g, '');
    if (t.startsWith('0')) t = '593' + t.slice(1);
    if (!t.startsWith('593')) t = '593' + t;
    return t;
  }

  /** Abre WhatsApp Web con el mensaje precargado.
   *  @param telefono  Número crudo (0XXXXXXXXX, +593..., etc.) — se normaliza internamente.
   *  @param lineas    Array de líneas del mensaje. Se unen con \n.
   *  @returns true si se abrió la URL, false si el teléfono estaba vacío o inválido. */
  abrir(telefono: string, lineas: string[]): boolean {
    const tel = this.normalizarTelefono(telefono);
    if (!tel) return false;
    const texto = lineas.join('\n');
    const url   = `https://api.whatsapp.com/send?phone=${tel}&text=${encodeURIComponent(texto)}`;
    window.open(url, '_blank');
    return true;
  }
}
