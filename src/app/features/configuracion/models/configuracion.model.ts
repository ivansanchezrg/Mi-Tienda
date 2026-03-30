// Fila cruda de la tabla configuraciones (clave/valor)
export interface ConfiguracionRow {
    clave: string;
    valor: string;
}

// Objeto tipado que se usa en toda la app
// Prefijo por módulo: negocio_, caja_, bus_, pos_
export interface Configuracion {
    negocio_nombre: string;
    caja_fondo_fijo_diario: number;
    caja_varios_transferencia_dia: number;
    bus_alerta_saldo_bajo: number;
    bus_dias_antes_facturacion: number;
    pos_descuentos_habilitados: boolean;
    pos_descuento_maximo_pct: number;
    pos_umbral_monto_descuento: number;
}

// Claves que se pueden actualizar desde la página de parámetros
export type ConfiguracionKey = keyof Configuracion;
