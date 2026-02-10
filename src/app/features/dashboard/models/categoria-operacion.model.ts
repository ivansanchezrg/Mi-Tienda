/**
 * Modelo de Categoría de Operación
 * Para clasificación contable de ingresos y egresos
 */
export interface CategoriaOperacion {
  id: number;
  tipo: 'INGRESO' | 'EGRESO';
  nombre: string;
  codigo: string;
  descripcion: string | null;
  activo: boolean;
  created_at: string;
}

/**
 * DTO para crear/actualizar categoría
 */
export interface CategoriaOperacionInsert {
  tipo: 'INGRESO' | 'EGRESO';
  nombre: string;
  codigo: string;
  descripcion?: string;
  activo?: boolean;
}
