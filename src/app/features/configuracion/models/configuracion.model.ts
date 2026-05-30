// Fila cruda de la tabla configuraciones (clave/valor)
export interface ConfiguracionRow {
    clave: string;
    valor: string;
}

// Objeto tipado que se usa en toda la app
// Prefijo por módulo: negocio_, caja_, bus_, pos_, nomina_
export interface Configuracion {
    negocio_nombre: string;
    negocio_telefono: string;
    negocio_direccion: string;
    recargas_celular_habilitada: boolean;
    recargas_bus_habilitada: boolean;
    caja_varios_activa: boolean;
    caja_varios_transferencia_dia: number;
    bus_alerta_saldo_bajo: number;
    bus_dias_antes_facturacion: number;
    pos_descuentos_habilitados: boolean;
    pos_descuento_maximo_pct: number;
    pos_umbral_monto_descuento: number;
    /** Tarifa IVA vigente en %. Usado en POS/Factura para extraer base gravada. Default: 15 */
    pos_iva_porcentaje: number;
    /** Tipo de comprobante configurado por el superadmin según régimen tributario del negocio */
    pos_tipo_comprobante: 'TICKET' | 'NOTA_VENTA' | 'FACTURA';
    /** Sueldo base por defecto para pago de nómina. Se precarga en el wizard, editable por el admin. */
    nomina_sueldo_base: number;
    nomina_dia_pago: number;
}

// Claves que se pueden actualizar desde la página de parámetros
export type ConfiguracionKey = keyof Configuracion;

/** Valores por defecto si la clave no existe en BD o falla la query */
export const CONFIGURACION_DEFAULTS: Configuracion = {
    negocio_nombre: 'Mi Tienda',
    negocio_telefono: '',
    negocio_direccion: '',
    recargas_celular_habilitada: false,
    recargas_bus_habilitada: false,
    caja_varios_activa: false,
    caja_varios_transferencia_dia: 0,
    bus_alerta_saldo_bajo: 10,
    bus_dias_antes_facturacion: 3,
    pos_descuentos_habilitados: false,
    pos_descuento_maximo_pct: 0,
    pos_umbral_monto_descuento: 0,
    pos_iva_porcentaje: 15,
    pos_tipo_comprobante: 'TICKET',
    nomina_sueldo_base: 0,
    nomina_dia_pago: 1,
};

/**
 * Convierte filas clave/valor de BD en el objeto tipado Configuracion.
 * Fuente única de verdad para el mapeo — usada por ConfigService y ConfiguracionService.
 * Agregar un campo nuevo: solo actualizar aquí.
 */
export function mapRowsToConfig(rows: ConfiguracionRow[]): Configuracion {
    const map = new Map(rows.map(r => [r.clave, r.valor]));
    const D = CONFIGURACION_DEFAULTS;

    // Parsea un número: si la clave existe en BD usa su valor (incluso 0), si no existe usa el default.
    const num = (key: string, def: number): number => {
        const raw = map.get(key);
        return raw !== undefined ? Number(raw) : def;
    };

    return {
        negocio_nombre:                map.get('negocio_nombre')                ?? D.negocio_nombre,
        negocio_telefono:              map.get('negocio_telefono')              ?? D.negocio_telefono,
        negocio_direccion:             map.get('negocio_direccion')             ?? D.negocio_direccion,
        recargas_celular_habilitada:   map.get('recargas_celular_habilitada') === 'true',
        recargas_bus_habilitada:       map.get('recargas_bus_habilitada') === 'true',
        caja_varios_activa:            map.get('caja_varios_activa') === 'true',
        caja_varios_transferencia_dia: num('caja_varios_transferencia_dia', D.caja_varios_transferencia_dia),
        bus_alerta_saldo_bajo:         num('bus_alerta_saldo_bajo',         D.bus_alerta_saldo_bajo),
        bus_dias_antes_facturacion:    num('bus_dias_antes_facturacion',    D.bus_dias_antes_facturacion),
        pos_descuentos_habilitados:    map.get('pos_descuentos_habilitados') === 'true',
        pos_descuento_maximo_pct:      num('pos_descuento_maximo_pct',      D.pos_descuento_maximo_pct),
        pos_umbral_monto_descuento:    num('pos_umbral_monto_descuento',    D.pos_umbral_monto_descuento),
        pos_iva_porcentaje:            num('pos_iva_porcentaje',            D.pos_iva_porcentaje),
        pos_tipo_comprobante:          (map.get('pos_tipo_comprobante') as 'TICKET' | 'NOTA_VENTA' | 'FACTURA') ?? D.pos_tipo_comprobante,
        nomina_sueldo_base:            num('nomina_sueldo_base',            D.nomina_sueldo_base),
        nomina_dia_pago:               num('nomina_dia_pago',               D.nomina_dia_pago),
    };
}
