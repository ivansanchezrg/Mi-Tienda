/**
 * Validación de cédula ecuatoriana (10 dígitos).
 * Algoritmo: módulo 10 con coeficientes [2,1,2,1,2,1,2,1,2].
 * - Los 2 primeros dígitos = provincia (01–24).
 * - Dígito 3 < 6 (persona natural).
 * - El dígito 10 es el verificador.
 */
export function validarCedulaEcuatoriana(cedula: string): boolean {
    if (!/^\d{10}$/.test(cedula)) return false;

    const provincia = parseInt(cedula.substring(0, 2), 10);
    if (provincia < 1 || provincia > 24) return false;

    const tercerDigito = parseInt(cedula[2], 10);
    if (tercerDigito >= 6) return false; // 6,7,8,9 = sociedades/RUC, no cédulas

    const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2];
    let suma = 0;

    for (let i = 0; i < 9; i++) {
        let valor = parseInt(cedula[i], 10) * coeficientes[i];
        if (valor >= 10) valor -= 9;
        suma += valor;
    }

    const digitoVerificador = suma % 10 === 0 ? 0 : 10 - (suma % 10);
    return digitoVerificador === parseInt(cedula[9], 10);
}
