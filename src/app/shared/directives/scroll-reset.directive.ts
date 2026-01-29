import { Directive, Input, OnChanges, SimpleChanges, inject } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';

/**
 * Directiva que hace scroll al top de un IonContent
 * cada vez que el valor vinculado cambia.
 *
 * Ideal para wizards o secciones dinámicas dentro de una misma página.
 * Para scroll reset al navegar entre páginas/tabs, usar ScrollablePage.
 *
 * @example
 * ```html
 * <ion-content [appScrollReset]="pasoActual">
 *
 * <!-- Con duración personalizada (ms) -->
 * <ion-content [appScrollReset]="seccion" [scrollResetDuration]="0">
 * ```
 */
@Directive({
  selector: 'ion-content[appScrollReset]',
  standalone: true
})
export class ScrollResetDirective implements OnChanges {
  private content = inject(IonContent);

  /** Valor a observar. Cuando cambia, se hace scroll al top. */
  @Input('appScrollReset') trigger: unknown;

  /** Duración de la animación de scroll en ms. Default: 300 */
  @Input() scrollResetDuration = 300;

  private initialized = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['trigger'] && this.initialized) {
      setTimeout(() => this.content.scrollToTop(this.scrollResetDuration));
    }
    this.initialized = true;
  }
}
