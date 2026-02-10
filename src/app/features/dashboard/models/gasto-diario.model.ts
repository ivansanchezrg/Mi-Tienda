/**
 * Categoría de Gasto Diario
 */
export interface CategoriaGasto {
  id: number;
  nombre: string;
  codigo: string;
  descripcion: string | null;
  activo: boolean;
  created_at: string;
}

/**
 * Modelo de Gasto Diario
 * Gastos operativos pagados con efectivo del día (NO afectan cajas registradas)
 */
export interface GastoDiario {
  id: string;
  fecha: string;
  empleado_id: number;
  categoria_gasto_id: number;
  monto: number;
  observaciones: string | null;
  comprobante_url: string | null;
  created_at: string;

  // Relación con empleado (join)
  empleado?: {
    id: number;
    nombre: string;
  } | null;

  // Relación con categoría (join)
  categorias_gastos?: {
    id: number;
    nombre: string;
    codigo: string;
  } | null;

  empleado_nombre?: string;     // Nombre del empleado (denormalizado para facilitar acceso)
  categoria_nombre?: string;     // Nombre de la categoría (denormalizado para facilitar acceso)
}

/**
 * DTO para crear gasto diario
 */
export interface GastoDiarioInput {
  categoria_gasto_id: number;
  monto: number;
  observaciones?: string;
  fotoComprobante?: string | null; // DataURL de la imagen
}

/**
 * Resultado del modal de gastos
 */
export interface GastoModalResult {
  categoria_gasto_id: number;
  monto: number;
  observaciones: string;
  fotoComprobante: string | null;
}
