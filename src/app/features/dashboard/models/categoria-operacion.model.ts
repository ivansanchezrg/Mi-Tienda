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
  seleccionable: boolean;  // false = creada por el sistema (no aparece en dropdowns del usuario)
  created_at: string;
}

/**
 * DTO para crear/actualizar categoría
 * `codigo` es opcional: el trigger fn_set_codigo_categoria_operacion() lo genera automáticamente (EG-XXX / IN-XXX)
 */
export interface CategoriaOperacionInsert {
  tipo: 'INGRESO' | 'EGRESO';
  nombre: string;
  codigo?: string;
  descripcion?: string;
  activo?: boolean;
  seleccionable?: boolean;
}
