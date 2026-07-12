/**
 * Anima un clon visual de un elemento "volando" hacia el centro de otro elemento
 * (feedback de agregar al carrito). El clon se inserta en <body>, transiciona
 * posición/tamaño/opacidad y se elimina solo al terminar la transición.
 *
 * Compartido por el catálogo del POS (card → pill/total del panel) y el selector
 * de variantes (thumbnail → botón continuar). Antes vivía duplicado en ambos.
 */
export function volarCloneHacia(
    clone: HTMLElement,
    desde: DOMRect,
    objetivo: HTMLElement,
    opts: { tamanoFinal: number; borderRadius: string; boxShadow: string }
): void {
    const rect = objetivo.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    clone.style.cssText = `
        position: fixed;
        left: ${desde.left}px;
        top: ${desde.top}px;
        width: ${desde.width}px;
        height: ${desde.height}px;
        margin: 0;
        pointer-events: none;
        z-index: 9999;
        overflow: hidden;
        border-radius: ${opts.borderRadius};
        outline: none;
        border: none;
        -webkit-tap-highlight-color: transparent;
        box-shadow: ${opts.boxShadow};
        opacity: 1;
        transform: scale(1);
        transition:
            left      0.45s cubic-bezier(0.4, 0, 0.2, 1),
            top       0.45s cubic-bezier(0.4, 0, 0.2, 1),
            width     0.45s cubic-bezier(0.4, 0, 0.2, 1),
            height    0.45s cubic-bezier(0.4, 0, 0.2, 1),
            opacity   0.35s ease 0.15s,
            transform 0.45s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    document.body.appendChild(clone);

    // Forzar reflow para que la transición arranque desde el estado inicial
    clone.getBoundingClientRect();

    const s = opts.tamanoFinal;
    clone.style.left      = `${cx - s / 2}px`;
    clone.style.top       = `${cy - s / 2}px`;
    clone.style.width     = `${s}px`;
    clone.style.height    = `${s}px`;
    clone.style.opacity   = '0';
    clone.style.transform = 'scale(0.3)';

    clone.addEventListener('transitionend', () => clone.remove(), { once: true });
}
