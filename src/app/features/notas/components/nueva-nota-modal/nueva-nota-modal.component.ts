import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, checkmarkOutline, createOutline } from 'ionicons/icons';

// Detecta líneas de lista — con o sin espacio después del prefijo
const LIST_PATTERN = /^(\d+)[.)]\s*|^[-*•]\s*/;

/**
 * Modal único para crear Y editar notas — mismo formulario, cambia título/botón según
 * si llega `textoInicial`. Evita duplicar el editor de texto (autolistas, contador de
 * caracteres) en dos componentes.
 */
@Component({
    selector: 'app-nueva-nota-modal',
    templateUrl: './nueva-nota-modal.component.html',
    styleUrls: ['./nueva-nota-modal.component.scss'],
    standalone: true,
    imports: [CommonModule, FormsModule, IonButton, IonIcon]
})
export class NuevaNotaModalComponent implements OnInit {

    private modalCtrl = inject(ModalController);

    /** Si viene con texto, el modal entra en modo edición (título/botón cambian). */
    @Input() textoInicial: string | null = null;

    texto = '';
    readonly MAX = 500;

    get esEdicion(): boolean {
        return this.textoInicial !== null;
    }

    constructor() {
        addIcons({ closeOutline, checkmarkOutline, createOutline });
    }

    ngOnInit() {
        if (this.textoInicial !== null) this.texto = this.textoInicial;
    }

    get restantes(): number {
        return this.MAX - this.texto.length;
    }

    get valido(): boolean {
        if (this.texto.trim().length === 0) return false;
        // En edición, sin cambios no hay nada que guardar — evita un UPDATE innecesario.
        if (this.esEdicion && this.texto.trim() === this.textoInicial?.trim()) return false;
        return true;
    }


    onKeydown(event: KeyboardEvent) {
        if (event.key !== 'Enter') return;

        const textarea = event.target as HTMLTextAreaElement;
        const pos = textarea.selectionStart;
        const value = textarea.value;

        // Línea actual (desde el último \n hasta el cursor)
        const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
        const lineText = value.substring(lineStart, pos);

        const match = lineText.match(LIST_PATTERN);
        if (match) {
            const matchedPrefix = match[0];
            const lineContent = lineText.slice(matchedPrefix.length).trim();

            // Línea vacía con solo el prefijo → romper la lista
            if (!lineContent) {
                event.preventDefault();
                const newValue = value.substring(0, lineStart) + '\n' + value.substring(pos);
                this.setTextareaValue(textarea, newValue, lineStart + 1);
                return;
            }

            // Calcular siguiente prefijo normalizado (siempre con espacio)
            event.preventDefault();
            const numMatch = lineText.match(/^(\d+)[.)]/);
            const nextPrefix = numMatch
                ? `${parseInt(numMatch[1], 10) + 1}. `
                : `${matchedPrefix.trim()} `;

            // Si la línea actual no tenía espacio, normalizar también esa línea
            const normalizedCurrent = numMatch
                ? lineText.replace(/^(\d+)[.)]\s*/, `${numMatch[1]}. `)
                : lineText.replace(/^([-*•])\s*/, '$1 ');

            const beforeLine = value.substring(0, lineStart);
            const afterCursor = value.substring(pos);
            const newValue = beforeLine + normalizedCurrent + '\n' + nextPrefix + afterCursor;
            const newCursor = lineStart + normalizedCurrent.length + 1 + nextPrefix.length;
            this.setTextareaValue(textarea, newValue, newCursor);
        }
    }

    private setTextareaValue(textarea: HTMLTextAreaElement, newValue: string, cursorPos: number) {
        // Actualizar el modelo y el DOM manualmente (ngModel no lo hace mid-event)
        textarea.value = newValue;
        textarea.setSelectionRange(cursorPos, cursorPos);
        this.texto = newValue;
    }

    cancelar() {
        this.modalCtrl.dismiss(null, 'cancel');
    }

    guardar() {
        if (!this.valido) return;
        this.modalCtrl.dismiss({ texto: this.limpiarTextoFinal(this.texto) }, 'confirm');
    }

    /**
     * El auto-numerado de onKeydown agrega el siguiente prefijo ("5. ") al presionar
     * Enter en una línea de lista — si el usuario guarda sin escribir contenido después,
     * queda una línea huérfana con solo el prefijo (ej. "5." suelto al final). trim()
     * no la detecta porque no es whitespace. Se quitan las líneas finales (y solo las
     * finales — una línea vacía en medio de la nota es intencional) cuyo contenido tras
     * el prefijo de lista está vacío.
     */
    private limpiarTextoFinal(texto: string): string {
        const lineas = texto.split('\n');
        while (lineas.length > 0) {
            const ultima = lineas[lineas.length - 1];
            const sinPrefijo = ultima.replace(LIST_PATTERN, '').trim();
            if (sinPrefijo === '') lineas.pop();
            else break;
        }
        return lineas.join('\n').trim();
    }
}
