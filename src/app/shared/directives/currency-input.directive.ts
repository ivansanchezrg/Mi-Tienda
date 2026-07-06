import { Directive, HostListener, inject } from '@angular/core';
import { NgControl } from '@angular/forms';
import { CurrencyService } from '../../core/services/currency.service';

/**
 * Directiva para automatizar el formato de moneda en <ion-input> o <input> nativo.
 *
 * Funcionalidades:
 * - Al perder el foco (ionBlur / blur): Formatea el valor a "1,250.00" (USD).
 * - Al ganar el foco (ionFocus / focus): Limpia el formato para edición (quita comas de miles).
 * - Inteligencia: Utiliza CurrencyService para corregir errores (ej: comas por puntos).
 *
 * Soporta ambos hosts porque ion-input emite (ionBlur/ionFocus) mientras que un
 * <input> HTML nativo (ej: dentro de un wrapper con estilo custom, con [(ngModel)]
 * o formControlName) solo emite los eventos DOM estándar (blur/focus). Sin los
 * listeners nativos, el formato nunca se aplicaba en esos inputs — el usuario veía
 * los decimales crudos que escribió en vez de "1,250.00".
 */
@Directive({
  selector: '[appCurrencyInput]',
  standalone: true
})
export class CurrencyInputDirective {
  private ngControl = inject(NgControl, { optional: true });
  private currencyService = inject(CurrencyService);

  /**
   * Evento al perder el foco (ionBlur — ion-input).
   * Aplica el formato visual final (Ej: 1,250.00).
   */
  @HostListener('ionBlur')
  onIonBlur() {
    this.aplicarFormato();
  }

  /**
   * Evento al ganar el foco (ionFocus — ion-input).
   * Muestra el número limpio (sin comas de miles) para facilitar la edición.
   */
  @HostListener('ionFocus')
  onIonFocus() {
    this.limpiarFormato();
  }

  /** Evento al perder el foco (blur — <input> nativo). */
  @HostListener('blur')
  onBlur() {
    this.aplicarFormato();
  }

  /** Evento al ganar el foco (focus — <input> nativo). */
  @HostListener('focus')
  onFocus() {
    this.limpiarFormato();
  }

  private aplicarFormato() {
    const value = this.ngControl?.value;
    if (value !== null && value !== undefined && value !== '') {
      // El format() ya incluye la lógica inteligente de parse()
      const formatted = this.currencyService.format(value);
      this.ngControl?.control?.setValue(formatted, { emitEvent: false });
    }
  }

  private limpiarFormato() {
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