export type EstadoDeuda = 'PENDIENTE' | 'SALDADA' | 'CANCELADA';

export interface DeudaEmpleado {
  id: string;
  empleado_id: number;
  turno_id: string;
  fecha: string;                 // DATE — fecha local del cierre
  monto_faltante: number;        // ABS(efectivo_fisico - efectivo_esperado) al contar el cajón
  estado: EstadoDeuda;
}

export interface DeudaEmpleadoConNombre extends DeudaEmpleado {
  empleado: { id: number; nombre: string };
}
