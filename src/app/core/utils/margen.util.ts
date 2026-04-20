/**
 * Calcula el precio de venta dado un costo y un margen sobre venta.
 * Fórmula: precio = costo / (1 - margen/100)
 */
export function calcularPrecioDesdeMargen(costo: number, margenPct: number): number {
    if (costo <= 0 || margenPct <= 0 || margenPct >= 100) return costo;
    const precio = costo / (1 - margenPct / 100);
    return Math.round(precio * 100) / 100;
}

/**
 * Calcula el margen sobre venta dado un costo y un precio de venta.
 * Fórmula: margen = (venta - costo) / venta * 100
 * Retorna 1 decimal. Retorna 0 si los valores son inválidos.
 */
export function calcularMargenDesdePrecio(costo: number, venta: number): number {
    // Redondear a 2 decimales antes de calcular para evitar drift de punto flotante
    const c = Math.round(costo * 100) / 100;
    const v = Math.round(venta * 100) / 100;
    if (c <= 0 || v <= 0 || v <= c) return 0;
    return Math.round(((v - c) / v) * 1000) / 10;
}
