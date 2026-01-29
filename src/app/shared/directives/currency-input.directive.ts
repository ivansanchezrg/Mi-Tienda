import { Directive, HostListener, inject } from '@angular/core';
import { NgControl } from '@angular/forms';
import { CurrencyService } from '../../core/services/currency.service';

/**
 * Directiva para automatizar el formato de moneda en componentes <ion-input>.
 * 
 * Funcionalidades:
 * - Al perder el foco (ionBlur): Formatea el valor a "1,250.00" (USD).
 * - Al ganar el foco (ionFocus): Limpia el formato para edición (quita comas de miles).
 * - Inteligencia: Utiliza CurrencyService para corregir errores (ej: comas por puntos).
 */
@Directive({
  selector: '[appCurrencyInput]',
  standalone: true
})
export class CurrencyInputDirective {
  private ngControl = inject(NgControl, { optional: true });
  private currencyService = inject(CurrencyService);

  /**
   * Evento al perder el foco (ionBlur).
   * Aplica el formato visual final (Ej: 1,250.00).
   */
  @HostListener('ionBlur')
  onBlur() {
    const value = this.ngControl?.value;
    if (value !== null && value !== undefined && value !== '') {
      // El format() ya incluye la lógica inteligente de parse()
      const formatted = this.currencyService.format(value);
      this.ngControl?.control?.setValue(formatted, { emitEvent: false });
    }
  }

  /**
   * Evento al ganar el foco (ionFocus).
   * Muestra el número limpio (sin comas de miles) para facilitar la edición.
   */
  @HostListener('ionFocus')
  onFocus() {
    const value = this.ngControl?.value;
    if (value !== null && value !== undefined && value !== '') {
      // Usamos parse() para limpiar el valor correctamente (ej: convertir comas mal puestas)
      const numericValue = this.currencyService.parse(value);
      
      // Si el valor es 0, lo dejamos vacío para que sea más fácil escribir
      if (numericValue === 0) {
        this.ngControl?.control?.setValue('', { emitEvent: false });
      } else {
        // Mostramos el número con su punto decimal y siempre 2 decimales para consistencia
        this.ngControl?.control?.setValue(numericValue.toFixed(2), { emitEvent: false });
      }
    }
  }
}