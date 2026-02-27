import { Directive, ViewChild } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { ViewWillEnter } from '@ionic/angular';

/**
 * Clase base para páginas que necesitan resetear el scroll al entrar.
 *
 * Ideal para páginas dentro de tabs, ya que Ionic las cachea
 * y mantiene la posición de scroll anterior.
 *
 * @example
 * ```typescript
 * export class HomePage extends ScrollablePage implements OnInit {
 *   // ionViewWillEnter se hereda automáticamente
 * }
 * ```
 *
 * Si la subclase necesita lógica adicional en ionViewWillEnter:
 * ```typescript
 * override ionViewWillEnter(): void {
 *   super.ionViewWillEnter();
 *   // lógica adicional...
 * }
 * ```
 */
@Directive()
export abstract class ScrollablePage implements ViewWillEnter {
  @ViewChild(IonContent, { static: false }) content!: IonContent;

  ionViewWillEnter(): void {
    this.content?.scrollToTop(0);
  }
}
