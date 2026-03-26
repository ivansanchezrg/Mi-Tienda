export interface Configuracion {
  id: string;
  nombre_negocio: string;
  fondo_fijo_diario: number;
  varios_transferencia_diaria: number;
  bus_alerta_saldo_bajo: number;
  bus_dias_antes_facturacion: number;
  created_at?: string;
}

export type UpdateConfiguracionDto = Pick<
  Configuracion,
  | 'nombre_negocio'
  | 'fondo_fijo_diario'
  | 'varios_transferencia_diaria'
  | 'bus_alerta_saldo_bajo'
  | 'bus_dias_antes_facturacion'
>;
