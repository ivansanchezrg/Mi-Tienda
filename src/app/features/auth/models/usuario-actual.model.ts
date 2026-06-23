export type RolUsuario = 'ADMIN' | 'EMPLEADO';

export interface UsuarioActual {
  id: string;              // UUID (antes era number)
  nombre: string;
  email: string;           // antes: usuario (columna renombrada en BD)
  rol: RolUsuario;         // ADMIN | EMPLEADO (viene de usuario_negocios via JWT)
  es_superadmin: boolean;
  negocio_id: string;      // UUID del negocio activo
  negocio_nombre: string;  // nombre para mostrar en sidebar
  negocio_slug: string;    // slug URL-safe único del negocio (ej: 'tienda-ivan') — viene del JWT
}
