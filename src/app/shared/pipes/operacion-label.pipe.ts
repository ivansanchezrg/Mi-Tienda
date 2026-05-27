import { Pipe, PipeTransform } from '@angular/core';

const LABELS: Record<string, string> = {
  INGRESO:                'Ingreso',
  EGRESO:                 'Egreso',
  APERTURA:               'Apertura de turno',
  CIERRE:                 'Cierre de turno',
  AJUSTE:                 'Ajuste',
  TRANSFERENCIA_SALIENTE: 'Traspaso enviado',
  TRANSFERENCIA_ENTRANTE: 'Traspaso recibido',
};

const COLORS: Record<string, string> = {
  INGRESO:                'success',
  EGRESO:                 'danger',
  TRANSFERENCIA_ENTRANTE: 'success',
  TRANSFERENCIA_SALIENTE: 'danger',
  APERTURA:               'primary',
  CIERRE:                 'success',
  AJUSTE:                 'warning',
};

const TIPOS_INGRESO = new Set(['INGRESO', 'TRANSFERENCIA_ENTRANTE', 'CIERRE']);
const TIPOS_EGRESO  = new Set(['EGRESO',  'TRANSFERENCIA_SALIENTE']);

/**
 * Pipe centralizado para mostrar operaciones de caja de forma legible.
 *
 * Modos:
 *   (tipo | operacionLabel:descripcion)  → label contextual del tipo
 *   (descripcion | operacionLabel:'motivo') → texto tras el '·' (o vacío)
 *   (tipo | operacionLabel:'color')      → color Ionic ('success', 'danger'…)
 *   (tipo | operacionLabel:'signo')      → '+', '-' o ''
 */
@Pipe({ name: 'operacionLabel', standalone: true, pure: true })
export class OperacionLabelPipe implements PipeTransform {

  transform(value: string | null, modo?: string | null): string {
    if (!value) return '';

    switch (modo) {

      case 'motivo':
        return value.includes('·') ? value.split('·')[1].trim() : '';

      case 'color':
        return COLORS[value] ?? 'medium';

      case 'signo':
        if (TIPOS_INGRESO.has(value)) return '+';
        if (TIPOS_EGRESO.has(value))  return '-';
        return '';

      default:
        // Label contextual — para transferencias usa la descripción como contraparte
        if ((value === 'TRANSFERENCIA_SALIENTE' || value === 'TRANSFERENCIA_ENTRANTE') && modo) {
          const contraparte = modo.split('·')[0].trim(); // "hacia Cajón" o "desde Tienda"
          return `Traspaso ${contraparte}`;
        }
        return LABELS[value] ?? value;
    }
  }
}
