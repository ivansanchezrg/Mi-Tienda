export type RolUsuario = 'ADMIN' | 'EMPLEADO';

/**
 * Fila de la tabla `usuarios` (campos propios, sin rol ni activo).
 * rol y activo viven en `usuario_negocios` — son por negocio, no globales.
 */
export interface UsuarioBase {
  id: string;              // UUID
  nombre: string;
  email: string;
  es_superadmin: boolean;
  created_at?: string;
}

/**
 * Usuario con su membresía en el negocio activo.
 * Resultado del JOIN usuarios ⟵ usuario_negocios filtrado por negocio_id del JWT.
 * Es la forma que usan las páginas/modales del módulo usuarios.
 */
export interface Usuario extends UsuarioBase {
  membresia_id: string;   // UUID de la fila en usuario_negocios
  rol: RolUsuario;        // rol en este negocio
  activo: boolean;        // activo en este negocio
  /**
   * TRUE si este usuario es el propietario (dueño) del negocio activo.
   * Calculado contra `negocios.propietario_usuario_id`.
   * El propietario tiene protecciones extra: no se le puede cambiar rol,
   * desactivar ni eliminar (validado por trigger SQL).
   */
  es_propietario: boolean;
}

/**
 * DTO para registrar un usuario nuevo en la tabla `usuarios`
 * y vincularlo al negocio activo via `usuario_negocios`.
 */
export interface CreateUsuarioDto {
  nombre: string;
  email: string;
  rol: RolUsuario;
}

/**
 * DTO para actualizar datos de un usuario.
 * nombre → UPDATE en `usuarios`.
 * rol / activo → UPDATE en `usuario_negocios`.
 */
export interface UpdateUsuarioDto {
  nombre?: string;
  rol?: RolUsuario;
  activo?: boolean;
}
