import { Directive, ElementRef, HostListener } from '@angular/core';

/**
 * Directiva que permite solo números, punto y coma en campos de entrada
 *
 * Casos de uso:
 * - Campos de moneda (1250.50 o 1250,50)
 * - Campos numéricos con decimales
 * - Cantidades y medidas
 *
 * Caracteres permitidos:
 * - Números: 0-9
 * - Punto: .
 * - Coma: ,
 *
 * Previene:
 * - Letras (a-z, A-Z)
 * - Espacios
 * - Caracteres especiales (@, #, $, etc.)
 *
 * @example
 * <ion-input appNumbersOnly formControlName="monto" inputmode="decimal"></ion-input>
 */
@Directive({
  selector: '[appNumbersOnly]',
  standalone: true
})
export class NumbersOnlyDirective {

  constructor(private el: ElementRef<HTMLInputElement>) {}

  /**
   * Regex que permite solo números, punto y coma
   */
  private readonly allowedPattern = /^[0-9.,]*$/;

  @HostListener('keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // Permitir teclas especiales de navegación
    const specialKeys = [
      'Backspace', 'Tab', 'End', 'Home', 'ArrowLeft', 'ArrowRight',
      'Delete', 'Enter'
    ];

    if (specialKeys.includes(event.key)) {
      return;
    }

    // Permitir Ctrl/Cmd + A (select all), C (copy), V (paste), X (cut)
    if ((event.ctrlKey || event.metaKey) && ['a', 'c', 'v', 'x'].includes(event.key.toLowerCase())) {
      return;
    }

    // Prevenir si no es número, punto o coma
    if (!/^[0-9.,]$/.test(event.key)) {
      event.preventDefault();
    }
  }

  @HostListener('paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    const paste = event.clipboardData?.getData('text');
    if (paste) {
      // Limpiar caracteres no permitidos del texto pegado
      const cleanText = paste.replace(/[^0-9.,]/g, '');
      const input = this.el.nativeElement;

      // Establecer el valor limpio
      input.value = cleanText;

      // Disparar evento input para que Angular detecte el cambio
      input.dispatchEvent(new Event('input', { bubbles: true }));

      event.preventDefault();
    }
  }

  @HostListener('input', ['$event'])
  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const cursorPosition = input.selectionStart;
    const originalLength = input.value.length;

    // Limpiar caracteres no permitidos en tiempo real
    const cleanValue = input.value.replace(/[^0-9.,]/g, '');

    if (cleanValue !== input.value) {
      input.value = cleanValue;

      // Mantener posición del cursor ajustada
      const newCursorPosition = cursorPosition ? cursorPosition - (originalLength - cleanValue.length) : 0;
      input.setSelectionRange(newCursorPosition, newCursorPosition);
    }
  }
}
