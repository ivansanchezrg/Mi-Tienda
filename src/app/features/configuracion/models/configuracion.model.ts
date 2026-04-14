// Fila cruda de la tabla configuraciones (clave/valor)
export interface ConfiguracionRow {
    clave: string;
    valor: string;
}

// Objeto tipado que se usa en toda la app
// Prefijo por módulo: negocio_, caja_, bus_, pos_, nomina_
export interface Configuracion {
    negocio_nombre: string;
    caja_fondo_fijo_diario: number;
    caja_varios_transferencia_dia: number;
    bus_alerta_saldo_bajo: number;
    bus_dias_antes_facturacion: number;
    pos_descuentos_habilitados: boolean;
    pos_descuento_maximo_pct: number;
    pos_umbral_monto_descuento: number;
    /** Tarifa IVA vigente en %. Usado en POS/Factura para extraer base gravada. Default: 15 */
    pos_iva_porcentaje: number;
    /** Sueldo base por defecto para pago de nómina. Se precarga en el wizard, editable por el admin. */
    nomina_sueldo_base: number;
}

// Claves que se pueden actualizar desde la página de parámetros
export type ConfiguracionKey = keyof Configuracion;

/** Valores por defecto si la clave no existe en BD o falla la query */
export const CONFIGURACION_DEFAULTS: Configuracion = {
    negocio_nombre: 'Mi Tienda',
    caja_fondo_fijo_diario: 20,
    caja_varios_transferencia_dia: 20,
    bus_alerta_saldo_bajo: 75,
    bus_dias_antes_facturacion: 3,
    pos_descuentos_habilitados: false,
    pos_descuento_maximo_pct: 10,
    pos_umbral_monto_descuento: 50,
    pos_iva_porcentaje: 15,
    nomina_sueldo_base: 450,
};

/**
 * Convierte filas clave/valor de BD en el objeto tipado Configuracion.
 * Fuente única de verdad para el mapeo — usada por ConfigService y ConfiguracionService.
 * Agregar un campo nuevo: solo actualizar aquí.
 */
export function mapRowsToConfig(rows: ConfiguracionRow[]): Configuracion {
    const map = new Map(rows.map(r => [r.clave, r.valor]));
    const D = CONFIGURACION_DEFAULTS;
    return {
        negocio_nombre:                map.get('negocio_nombre')                ?? D.negocio_nombre,
        caja_fondo_fijo_diario:        Number(map.get('caja_fondo_fijo_diario'))        || D.caja_fondo_fijo_diario,
        caja_varios_transferencia_dia: Number(map.get('caja_varios_transferencia_dia')) || D.caja_varios_transferencia_dia,
        bus_alerta_saldo_bajo:         Number(map.get('bus_alerta_saldo_bajo'))         || D.bus_alerta_saldo_bajo,
        bus_dias_antes_facturacion:    Number(map.get('bus_dias_antes_facturacion'))    || D.bus_dias_antes_facturacion,
        pos_descuentos_habilitados:    map.get('pos_descuentos_habilitados') === 'true',
        pos_descuento_maximo_pct:      Number(map.get('pos_descuento_maximo_pct'))      || D.pos_descuento_maximo_pct,
        pos_umbral_monto_descuento:    Number(map.get('pos_umbral_monto_descuento'))    || D.pos_umbral_monto_descuento,
        pos_iva_porcentaje:            Number(map.get('pos_iva_porcentaje'))            || D.pos_iva_porcentaje,
        nomina_sueldo_base:            Number(map.get('nomina_sueldo_base'))            || D.nomina_sueldo_base,
    };
}
