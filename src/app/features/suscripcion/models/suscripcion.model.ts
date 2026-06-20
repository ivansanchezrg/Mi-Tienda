/**
 * Modelos del sistema de planes y suscripciones (monetización SaaS).
 * Ver docs/PLAN-PLANES-SUSCRIPCION.md
 *
 * Terminología: "suscripción"/"plan" — NO confundir con "membresía"
 * (usuario_negocios = rol del usuario en el negocio).
 */

/**
 * Estado efectivo que devuelve fn_estado_suscripcion. Los estados de vencimiento son
 * DERIVADOS por fecha (no almacenados) y distinguen el origen para el contexto comercial:
 *   - TRIAL_VENCIDO → la prueba gratuita terminó (nunca pagó) → la UI ofrece ACTIVAR.
 *   - VENCIDA       → era cliente pagador y no renovó           → la UI ofrece RENOVAR.
 */
export type EstadoSuscripcion =
  'TRIAL' | 'ACTIVA' | 'TRIAL_VENCIDO' | 'VENCIDA' | 'SUSPENDIDA' | 'CANCELADA';

/** Mapa de features desbloqueadas por el plan, ej: { pos: true, ia: false } */
export type PlanFeatures = Record<string, boolean>;

/**
 * Resultado de fn_estado_suscripcion(p_negocio_id).
 * `bloqueada` resume las 3 razones de bloqueo (vencida/suspendida/cancelada)
 * en un solo booleano — es lo único que el guard necesita mirar.
 */
export interface EstadoSuscripcionResult {
  tiene_suscripcion: boolean;
  bloqueada:         boolean;
  estado?:           EstadoSuscripcion;
  plan_codigo?:      string;
  plan_nombre?:      string;
  /** Periodo que el cliente contrató (define el precio cobrado). */
  periodo?:          'MENSUAL' | 'ANUAL';
  /** Precio que aplica según el periodo contratado (lo que realmente paga). */
  precio?:           number;
  /** Ambos precios del plan, por si la UI muestra el toggle/ahorro. */
  precio_mensual?:   number;
  precio_anual?:     number | null;
  vence_el?:         string;   // ISO timestamp
  dias_restantes?:   number;
  features?:         PlanFeatures;
}

/**
 * Fila de la tabla planes (catálogo global). Precio dual: todo plan tiene
 * precio_mensual; precio_anual es opcional (NULL = el plan no ofrece pago anual).
 */
export interface Plan {
  id:             string;
  codigo:         string;
  nombre:         string;
  descripcion:    string | null;
  precio_mensual: number;
  precio_anual:   number | null;
  trial_dias:     number;
  /** Tope de negocios por propietario (NULL = ilimitado). PRO=1, MAX=3. */
  max_negocios:   number | null;
  features:       PlanFeatures;
  activo:         boolean;
  orden:          number;
}

/** Fila de la tabla metodos_pago_suscripcion (catálogo global). */
export interface MetodoPago {
  id:     string;
  codigo: string;
  nombre: string;
  icono:  string;
  activo: boolean;
  orden:  number;
}

/** Una cuenta bancaria dentro de config_plataforma.cuentas_bancarias (JSONB). */
export interface CuentaBancaria {
  banco:   string;
  tipo:    'Ahorros' | 'Corriente';
  numero:  string;
  titular: string;
  cedula:  string;
}

/** Datos de cobro globales de la plataforma (tabla config_plataforma, singleton). */
export interface ConfigPlataforma {
  whatsapp_cobro:    string | null;
  cuentas_bancarias: CuentaBancaria[];
}

/** Estado de suscripción incluyendo 'SIN_SUSCRIPCION' (solo en el listado admin). */
export type EstadoSuscripcionAdmin = EstadoSuscripcion | 'SIN_SUSCRIPCION';

/** Fila del listado de suscripciones del panel admin (fn_listar_suscripciones_admin). */
export interface SuscripcionAdmin {
  negocio_id:         string;
  negocio_nombre:     string;
  propietario_nombre: string | null;
  propietario_email:  string | null;
  estado:             EstadoSuscripcionAdmin;
  plan_codigo:        string | null;
  plan_nombre:        string | null;
  precio:             number | null;
  periodo:            'MENSUAL' | 'ANUAL' | null;
  vence_el:           string | null;
  dias_restantes:     number | null;
}
