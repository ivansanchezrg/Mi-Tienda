/**
 * Retorna la fecha actual en formato YYYY-MM-DD usando la zona horaria LOCAL del dispositivo.
 *
 * ⚠️ NUNCA usar `new Date().toISOString().split('T')[0]` — devuelve la fecha en UTC,
 *    lo que puede retornar la fecha de MAÑANA si son más de las 7pm en Ecuador (UTC-5).
 *
 * @returns string en formato "YYYY-MM-DD"
 * @example
 * getFechaLocal() // "2026-02-26" (hora local)
 */
export function getFechaLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
