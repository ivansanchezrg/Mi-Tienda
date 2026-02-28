export interface TurnoCaja {
  id: string;
  numero_turno: number;
  empleado_id: number;
  hora_fecha_apertura: string;
  hora_cierre: string | null;
  observaciones: string | null;
}

export interface TurnoCajaConEmpleado extends TurnoCaja {
  empleado: { id: number; nombre: string };
}

export type EstadoCajaTipo = 'SIN_ABRIR' | 'TURNO_EN_CURSO' | 'CERRADA';

export interface EstadoCaja {
  estado: EstadoCajaTipo;
  turnoActivo: TurnoCajaConEmpleado | null;
  empleadoNombre: string;
  horaApertura: string;
  turnosHoy: number;
}
