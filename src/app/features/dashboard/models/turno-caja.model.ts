export interface TurnoCaja {
  id: string;
  numero_turno: number;
  empleado_id: string;
  hora_fecha_apertura: string;
  hora_fecha_cierre: string | null;
  observaciones: string | null;
  fondo_cubierto: boolean | null;
}

export interface TurnoCajaConEmpleado extends TurnoCaja {
  empleado: { id: string; nombre: string };
}

export type EstadoCajaTipo = 'SIN_ABRIR' | 'TURNO_EN_CURSO' | 'CERRADA';

export interface EstadoCaja {
  estado: EstadoCajaTipo;
  turnoActivo: TurnoCajaConEmpleado | null;
  empleadoNombre: string;
  horaApertura: string;
  turnosHoy: number;
}

/** Resultado retornado por fn_cierre_emergencia_turno */
export interface ResultadoCierreEmergencia {
  success: boolean;
  turno_id: string;
  fecha: string;
  empleado_ausente: { id: string; nombre: string };
  admin_autorizador: { id: string; nombre: string };
  motivo: string;
  conteo_fisico: {
    efectivo_fisico: number;
    saldo_digital_antes: number;
    efectivo_esperado: number;
    diferencia: number;
    ajuste_aplicado: boolean;
    hubo_movimientos: boolean;
  };
  distribucion_efectivo: {
    fondo_en_cajon: boolean;
    transferencia_varios: number;
    deposito_tienda: number;
    deficit_varios: number;
    monto_reposicion_apertura: number;
  };
  saldos_finales: {
    caja_chica: number;
    caja: number;
    varios: number;
  };
  nota: string;
}
