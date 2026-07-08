/**
 * Zona horaria oficial de Ecuador continental.
 * Se usa en TODOS los formatters para garantizar hora Ecuador
 * sin importar la configuración del dispositivo.
 */
const TZ_ECUADOR = 'America/Guayaquil';

// ─────────────────────────────────────────────────────────────
// FECHA ACTUAL
// ─────────────────────────────────────────────────────────────

/**
 * Retorna la fecha actual en formato YYYY-MM-DD en zona horaria Ecuador.
 *
 * ⚠️ NUNCA usar `new Date().toISOString().split('T')[0]` — devuelve fecha UTC,
 *    lo que puede retornar MAÑANA si son más de las 7 pm en Ecuador (UTC-5).
 *
 * @returns string "YYYY-MM-DD" en hora Ecuador
 * @example
 * getFechaLocal() // "2026-03-10"
 */
export function getFechaLocal(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_ECUADOR,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()); // en-CA produce "YYYY-MM-DD" nativamente
}

// ─────────────────────────────────────────────────────────────
// RANGOS DE FECHA PARA QUERIES SUPABASE
// ─────────────────────────────────────────────────────────────

/**
 * Retorna el inicio del día siguiente a una fecha local dada, en ISO UTC.
 *
 * Usar como upper bound EXCLUSIVO (.lt) en rangos de fecha para cubrir
 * todo el día sin perder operaciones en los últimos milisegundos del día.
 *
 * @param fechaLocal  "YYYY-MM-DD" en hora Ecuador (salida de getFechaLocal())
 * @example
 * .lt('fecha', getInicioDiaSiguienteDeISO('2026-03-10'))
 */
export function getInicioDiaSiguienteDeISO(fechaLocal: string): string {
  const [year, month, day] = fechaLocal.split('-').map(Number);
  // new Date(y, m-1, d+1) usa medianoche LOCAL → toISOString() convierte a UTC
  return new Date(year, month - 1, day + 1).toISOString();
}

/**
 * Versión sin parámetros: inicio de mañana en ISO UTC.
 * Equivalente a `getInicioDiaSiguienteDeISO(getFechaLocal())`.
 */
export function getInicioDiaSiguienteISO(): string {
  return getInicioDiaSiguienteDeISO(getFechaLocal());
}

/**
 * Retorna el inicio de hace N días en ISO UTC, para usar como lower bound en queries.
 * @param dias  Número de días hacia atrás (7 = semana, 30 = mes)
 * @example
 * .gte('fecha', getInicioHaceNDiasISO(7))  // últimos 7 días
 */
export function getInicioHaceNDiasISO(dias: number): string {
  const fecha = getFechaLocal();
  const [year, month, day] = fecha.split('-').map(Number);
  return new Date(year, month - 1, day - dias).toISOString();
}

// ─────────────────────────────────────────────────────────────
// PARSEO DE TIMESTAMPS DE SUPABASE
// ─────────────────────────────────────────────────────────────

/**
 * Normaliza un ISO timestamp de Supabase a un objeto Date UTC.
 *
 * Supabase puede devolver timestamps sin indicador de zona horaria
 * (ej. "2026-03-10T15:30:00"), lo que hace que `new Date()` los interprete
 * como hora LOCAL en algunos entornos en vez de UTC.
 * Esta función fuerza la interpretación UTC añadiendo 'Z' si falta timezone.
 *
 * @param iso  Timestamp ISO devuelto por Supabase (con o sin tz)
 * @returns    Date correspondiente al instante UTC correcto
 */
export function isoAFechaLocal(iso: string): Date {
  const normalizado = /[Zz]$|[+\-]\d{2}:\d{2}$/.test(iso) ? iso : iso + 'Z';
  return new Date(normalizado);
}

// ─────────────────────────────────────────────────────────────
// FORMATTERS DE DISPLAY — SIEMPRE EN HORA ECUADOR
// ─────────────────────────────────────────────────────────────

/**
 * Formatea un ISO timestamp como fecha corta en hora Ecuador.
 * @example formatFechaEC('2026-03-11T02:11:00Z') // "10 mar 2026"
 */
export function formatFechaEC(iso: string): string {
  return isoAFechaLocal(iso).toLocaleDateString('es-EC', {
    day: 'numeric', month: 'short', year: 'numeric',
    timeZone: TZ_ECUADOR,
  });
}

/**
 * Formatea un ISO timestamp como hora en hora Ecuador.
 * @example formatHoraEC('2026-03-11T02:11:00Z') // "09:11 p. m."
 */
export function formatHoraEC(iso: string): string {
  return isoAFechaLocal(iso).toLocaleTimeString('es-EC', {
    hour: '2-digit', minute: '2-digit',
    timeZone: TZ_ECUADOR,
  });
}

/**
 * Formatea un ISO timestamp como fecha + hora completa en hora Ecuador.
 * @example formatFechaHoraEC('2026-03-11T02:11:00Z') // "10 mar 2026, 09:11 p. m."
 */
export function formatFechaHoraEC(iso: string): string {
  return isoAFechaLocal(iso).toLocaleString('es-EC', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: TZ_ECUADOR,
  });
}

/**
 * Formatea un timestamp en milisegundos (Date.now()) como hora corta en hora Ecuador.
 * Usado por los sellos de frescura offline ("Actualizado HH:mm").
 * @example formatHoraDesdeTimestamp(1710000000000) // "09:11 p. m."
 */
export function formatHoraDesdeTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('es-EC', {
    hour: '2-digit', minute: '2-digit',
    timeZone: TZ_ECUADOR,
  });
}
