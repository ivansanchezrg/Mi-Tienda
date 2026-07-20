export interface ModulosNegocio {
  celular:           boolean;
  bus:               boolean;
  varios:            boolean;
  varios_monto:      number;
  tipo_comprobante:  'TICKET' | 'NOTA_VENTA' | 'FACTURA';
}

/** Estado de suscripción de un negocio (subset de SuscripcionAdmin, anidado en NegocioAdmin). */
export interface SuscripcionNegocio {
  estado:         string;          // ACTIVA | TRIAL | VENCIDA | SUSPENDIDA | CANCELADA | SIN_SUSCRIPCION
  plan_codigo:    string | null;
  plan_nombre:    string | null;
  precio:         number | null;
  periodo:        'MENSUAL' | 'ANUAL' | null;
  vence_el:       string | null;
  dias_restantes: number | null;
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
  created_at:             string;
  modulos:                ModulosNegocio;
  suscripcion:            SuscripcionNegocio | null;
}

export interface PropietarioGrupo {
  usuario_id: string;
  nombre:     string;
  email:      string;
  /** Derivado: el propietario está suspendido por cobro si TODOS sus negocios
   *  tienen la suscripción en estado SUSPENDIDA. Controla el estilo del header
   *  y el texto del menú (Suspender ↔ Reactivar). */
  suspendido: boolean;
  negocios:   NegocioAdmin[];
  /** Presente solo si el propietario está marcado para purga (ver
   *  docs/suscripcion/SUSCRIPCION-README.md). Viene de fn_listar_negocios_pendientes_purga,
   *  un solo registro representativo (todos sus negocios comparten estas fechas). */
  purga?: {
    telefono_contacto:   string | null;
    purga_programada_el: string;
    dias_restantes_purga: number;
    puede_purgar_ya:      boolean;
  };
}
