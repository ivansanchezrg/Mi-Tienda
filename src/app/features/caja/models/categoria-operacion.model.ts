/**
 * Modelo de Categoría de Operación
 * Para clasificación contable de ingresos y egresos
 */
export interface CategoriaOperacion {
  id: string;
  tipo: 'INGRESO' | 'EGRESO';
  nombre: string;
  codigo: string;
  descripcion: string | null;
  activo: boolean;
  created_at: string;
}

/**
 * DTO para crear/actualizar categoría de usuario.
 * `codigo` es opcional: el trigger fn_set_codigo_categoria_operacion() lo genera automáticamente (EG-XXX / IN-XXX).
 */
export interface CategoriaOperacionInsert {
  tipo: 'INGRESO' | 'EGRESO';
  nombre: string;
  codigo?: string;
  descripcion?: string;
  activo?: boolean;
}
