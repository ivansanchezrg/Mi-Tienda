export type RolUsuario = 'ADMIN' | 'EMPLEADO';

export interface UsuarioActual {
  id: number;
  nombre: string;
  usuario: string;
  activo: boolean;
  rol: RolUsuario;
}
