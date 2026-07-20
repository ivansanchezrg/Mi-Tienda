import { Component, Input, Output, EventEmitter } from '@angular/core';
import { IonIcon } from '@ionic/angular/standalone';

export type BannerColor = 'warning' | 'primary' | 'danger' | 'success';

/**
 * Banner genérico de presentación pura — una franja superior para avisos pequeños.
 *
 * No conoce red, ventas ni suscripciones: recibe todo por @Input(). Lo consumen
 * componentes con lógica propia (offline-banner, suscripcion-banner). Esto da
 * "un banner para toda clase de aviso" por composición, sin acoplar la presentación
 * a un dominio. Ver docs/suscripcion/SUSCRIPCION-README.md, sección "Banner de aviso preventivo".
 *
 * Maneja: animación slideDown, alto mínimo 44px y la franja de safe-area-top
 * (status bar de Android). El consumidor decide CUÁNDO mostrarlo (con @if).
 */
@Component({
  selector: 'app-banner',
  templateUrl: './banner.component.html',
  styleUrls: ['./banner.component.scss'],
  standalone: true,
  imports: [IonIcon],
})
export class BannerComponent {
  /** Texto principal del banner. */
  @Input() texto = '';
  /** Color de fondo (semántico). warning = aviso, primary = info/progreso, danger = crítico. */
  @Input() color: BannerColor = 'warning';
  /**
   * Nombre del ionicon a la izquierda. Se renderiza con [name] dinámico, así que
   * el icono DEBE registrarse con addIcons() en el COMPONENTE CONSUMIDOR (no aquí),
   * o Android lo elimina por tree-shaking. Ver CLAUDE.md → "Iconos en Android".
   */
  @Input() icono = '';
  /** Texto de la acción opcional a la derecha (botón). Si vacío, no se muestra botón. */
  @Input() accionTexto = '';
  /** Si true, todo el banner es clickeable (emite accion). Útil cuando no hay botón separado. */
  @Input() clickeable = false;

  /** Se emite al tocar el botón de acción o el banner (si clickeable). */
  @Output() accion = new EventEmitter<void>();

  onBannerClick() {
    if (this.clickeable) this.accion.emit();
  }

  onAccionClick(event: Event) {
    event.stopPropagation();
    this.accion.emit();
  }
}
