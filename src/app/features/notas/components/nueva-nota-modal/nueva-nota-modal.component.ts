import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, checkmarkOutline, createOutline } from 'ionicons/icons';

// Detecta líneas de lista — con o sin espacio después del prefijo
const LIST_PATTERN = /^(\d+)[.)]\s*|^[-*•]\s*/;

@Component({
    selector: 'app-nueva-nota-modal',
    templateUrl: './nueva-nota-modal.component.html',
    styleUrls: ['./nueva-nota-modal.component.scss'],
    standalone: true,
    imports: [CommonModule, FormsModule, IonButton, IonIcon]
})
export class NuevaNotaModalComponent {

    private modalCtrl = inject(ModalController);

    texto = '';
    readonly MAX = 500;

    constructor() {
        addIcons({ closeOutline, checkmarkOutline, createOutline });
    }

    get restantes(): number {
        return this.MAX - this.texto.length;
    }

    get valido(): boolean {
        return this.texto.trim().length > 0;
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
        this.modalCtrl.dismiss({ texto: this.texto.trim() }, 'confirm');
    }
}
