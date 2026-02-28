export interface Configuracion {
  id: string;
  fondo_fijo_diario: number;
  caja_chica_transferencia_diaria: number;
  bus_alerta_saldo_bajo: number;
  bus_dias_antes_facturacion: number;
  created_at?: string;
  updated_at?: string;
}

export type UpdateConfiguracionDto = Pick<
  Configuracion,
  | 'fondo_fijo_diario'
  | 'caja_chica_transferencia_diaria'
  | 'bus_alerta_saldo_bajo'
  | 'bus_dias_antes_facturacion'
>;
