import { Directive, ElementRef, HostListener, OnInit, OnDestroy } from '@angular/core';

/**
 * Aplicar en cualquier contenedor overflow-x: auto con scroll horizontal.
 *
 * Hace dos cosas:
 * 1. Redirige el wheel vertical al scrollLeft (desktop sin trackpad 2D).
 * 2. Añade la clase `has-h-overflow` al padre cuando el contenido desborda,
 *    para que el CSS pueda mostrar un hint "← →" solo en desktop.
 *
 * Uso: <div class="caja-scroll" appHorizontalScroll>
 */
@Directive({
  selector: '[appHorizontalScroll]',
  standalone: true,
})
export class HorizontalScrollDirective implements OnInit, OnDestroy {
  private ro!: ResizeObserver;

  constructor(private el: ElementRef<HTMLElement>) {}

  ngOnInit() {
    // Observar cambios de tamaño para actualizar has-h-overflow en tiempo real
    this.ro = new ResizeObserver(() => this.updateOverflowClass());
    this.ro.observe(this.el.nativeElement);
    this.updateOverflowClass();
  }

  ngOnDestroy() {
    this.ro.disconnect();
  }

  @HostListener('wheel', ['$event'])
  onWheel(event: WheelEvent) {
    const el = this.el.nativeElement;
    if (el.scrollWidth <= el.clientWidth) return;

    // Trackpad 2D: el usuario ya scrollea horizontal — no interferir
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;

    event.preventDefault();
    el.scrollLeft += event.deltaY;
  }

  private updateOverflowClass() {
    const el = this.el.nativeElement;
    const parent = el.parentElement;
    if (!parent) return;

    if (el.scrollWidth > el.clientWidth) {
      parent.classList.add('has-h-overflow');
    } else {
      parent.classList.remove('has-h-overflow');
    }
  }
}
