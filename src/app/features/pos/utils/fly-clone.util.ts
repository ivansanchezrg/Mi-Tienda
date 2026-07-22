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
    opts: { tamanoFinal: number; borderRadius: string; boxShadow: string; escalaInicial?: number }
): void {
    const rect = objetivo.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // El clon puede partir más pequeño que el elemento original (escalaInicial < 1) —
    // se centra en la posición original para no saltar. Un arranque más chico hace el
    // vuelo más ligero (menos "peso" visual atravesando la pantalla).
    const escala = opts.escalaInicial ?? 1;
    const w0 = desde.width * escala;
    const h0 = desde.height * escala;
    const left0 = desde.left + (desde.width - w0) / 2;
    const top0  = desde.top + (desde.height - h0) / 2;

    clone.style.cssText = `
        position: fixed;
        left: ${left0}px;
        top: ${top0}px;
        width: ${w0}px;
        height: ${h0}px;
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

    // Limpieza robusta: normalmente el transitionend remueve el clon. Fallback por timeout
    // (transición = 0.45s) por si transitionend no dispara — con taps muy rápidos evita que
    // queden clones huérfanos acumulándose en el <body>. clearTimeout impide doble-remove.
    let limpio = false;
    const remover = () => {
        if (limpio) return;
        limpio = true;
        clearTimeout(fallback);
        clone.remove();
    };
    const fallback = setTimeout(remover, 700);
    clone.addEventListener('transitionend', remover, { once: true });
}
