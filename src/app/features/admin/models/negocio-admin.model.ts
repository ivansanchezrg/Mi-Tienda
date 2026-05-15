export interface ModulosNegocio {
  celular:           boolean;
  bus:               boolean;
  varios:            boolean;
  varios_monto:      number;
  tipo_comprobante:  'TICKET' | 'NOTA_VENTA' | 'FACTURA';
}

export interface NegocioAdmin {
  id:                     string;
  nombre:                 string;
  slug:                   string;
  propietario_usuario_id: string;
  propietario_nombre:     string;
  propietario_email:      string;
  propietario_activo:     boolean;
  created_at:             string;
  modulos:                ModulosNegocio;
}

export interface PropietarioGrupo {
  usuario_id: string;
  nombre:     string;
  email:      string;
  activo:     boolean;
  negocios:   NegocioAdmin[];
}
