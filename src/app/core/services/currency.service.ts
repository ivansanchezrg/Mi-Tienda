import { Injectable } from '@angular/core';

/**
 * Servicio para el manejo inteligente de formatos de moneda (USD).
 * Maneja automáticamente errores comunes de usuario como el uso de comas
 * en lugar de puntos para decimales.
 */
@Injectable({
  providedIn: 'root'
})
export class CurrencyService {
  private locale = 'en-US';

  /**
   * Formatea un valor a string USD (1,250.00).
   * Utiliza la lógica de parse() para limpiar la entrada primero.
   */
  format(value: number | string | null | undefined): string {
    const numericValue = this.parse(value);
    
    if (value === null || value === undefined || value === '') {
      if (typeof value === 'number' && value === 0) return '0.00';
      return '';
    }

    return new Intl.NumberFormat(this.locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(numericValue);
  }

  /**
   * Convierte cualquier entrada de usuario a un número válido.
   * Detecta inteligentemente si una coma es decimal o de miles.
   */
  parse(value: string | number | null | undefined): number {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return value;

    let str = value.toString().trim();
    if (str === '') return 0;

    // 1. Identificar separadores
    const hasComma = str.includes(',');
    const hasDot = str.includes('.');

    // 2. CASO: Solo tiene comas (ej: "200,80" o "1,250")
    if (hasComma && !hasDot) {
      const parts = str.split(',');
      
      // Si solo hay una coma (ej: "200,80")
      if (parts.length === 2) {
        const decimalPart = parts[1];
        // Si tiene 1 o 2 dígitos después de la coma, es un error de decimal (coma por punto)
        if (decimalPart.length === 1 || decimalPart.length === 2) {
          str = str.replace(',', '.');
        } else {
          // Si tiene 3 o más, es separador de miles estándar USD
          str = str.replace(/,/g, '');
        }
      } else {
        // Si tiene múltiples comas, son separadores de miles
        str = str.replace(/,/g, '');
      }
    } 
    // 3. CASO: Tiene ambos (ej: "1,250.50" estándar o "1.250,50" europeo)
    else if (hasComma && hasDot) {
      const lastComma = str.lastIndexOf(',');
      const lastDot = str.lastIndexOf('.');
      
      // El que esté más a la derecha es el decimal
      if (lastComma > lastDot) {
        // Estilo europeo/latam: 1.250,50 -> Limpiar puntos y cambiar coma a punto
        str = str.replace(/\./g, '').replace(',', '.');
      } else {
        // Estilo USD: 1,250.50 -> Solo limpiar comas
        str = str.replace(/,/g, '');
      }
    }
    // 4. CASO: Solo tiene puntos (ej: "1.250" o "1250.50")
    else if (!hasComma && hasDot) {
      const parts = str.split('.');
      // Si hay más de un punto, son separadores de miles (estilo europeo 1.250.000)
      if (parts.length > 2) {
        str = str.replace(/\./g, '');
      } else if (parts.length === 2) {
        // Si hay un punto y tiene 3 dígitos, podría ser miles (1.250) o decimal (1.250)
        // En USD asumimos decimal a menos que sea muy obvio que son miles
        // pero mantenemos el punto como decimal por defecto del sistema.
      }
    }

    const numericValue = parseFloat(str);
    return isNaN(numericValue) ? 0 : numericValue;
  }
}