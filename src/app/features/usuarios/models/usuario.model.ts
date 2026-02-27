export type RolUsuario = 'ADMIN' | 'EMPLEADO';

export interface Usuario {
  id: number;
  nombre: string;
  usuario: string;
  activo: boolean;
  rol: RolUsuario;
  created_at?: string;
}

export interface CreateUsuarioDto {
  nombre: string;
  usuario: string;
  rol: RolUsuario;
}

export interface UpdateUsuarioDto {
  nombre?: string;
  rol?: RolUsuario;
  activo?: boolean;
}
