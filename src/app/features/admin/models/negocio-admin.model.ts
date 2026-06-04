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
  // Datos de identidad (tabla negocios)
  telefono:               string | null;
  direccion:              string | null;
  correo_electronico:     string | null;
  ruc:                    string | null;
  razon_social:           string | null;
  nombre_comercial:       string | null;
  codigo_establecimiento: string;
  codigo_punto_emision:   string;
  ambiente_sri:           number;
  obligado_contabilidad:  boolean;
  // Control
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
