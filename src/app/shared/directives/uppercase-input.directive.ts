import { Directive, ElementRef, HostListener, inject, Optional, Self } from '@angular/core';
import { NgControl } from '@angular/forms';

/**
 * Transforma a mayúsculas el texto mientras el usuario escribe.
 * Compatible con ReactiveFormsModule — actualiza el FormControl además del DOM.
 *
 * Uso:
 *   <ion-input appUppercaseInput formControlName="nombre"></ion-input>
 *   <input appUppercaseInput formControlName="nombre">
 */
@Directive({
    selector: '[appUppercaseInput]',
    standalone: true
})
export class UppercaseInputDirective {
    private el = inject<ElementRef<HTMLInputElement>>(ElementRef);
    @Optional() @Self() private ngControl = inject(NgControl, { optional: true });

    @HostListener('ionInput')
    onIonInput(): void {
        this.transformar();
    }

    @HostListener('input')
    onInput(): void {
        this.transformar();
    }

    @HostListener('paste')
    onPaste(): void {
        setTimeout(() => this.transformar());
    }

    private transformar(): void {
        // Siempre resolver el <input> nativo — ion-input es un web component
        // y su event.target apunta al host, no al input interno del shadow DOM
        const input = this.resolverInput();
        if (!input) return;

        const upper = input.value.toUpperCase();
        if (input.value === upper) return; // sin cambio, evitar loop

        const cursor = input.selectionStart;
        input.value = upper;

        if (cursor !== null) {
            input.setSelectionRange(cursor, cursor);
        }

        if (this.ngControl?.control) {
            this.ngControl.control.setValue(upper, { emitEvent: false });
        } else {
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    /**
     * ion-input envuelve el <input> nativo en shadow DOM.
     * querySelector('input') lo encuentra; en un <input> nativo directo
     * no hay shadow DOM y el nativeElement ya es el input.
     */
    private resolverInput(): HTMLInputElement | null {
        const native = this.el.nativeElement;
        return (native.querySelector('input') as HTMLInputElement) ?? native;
    }
}
