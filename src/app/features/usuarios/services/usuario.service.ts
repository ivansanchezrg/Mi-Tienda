import { Injectable, inject } from '@angular/core';
import { SupabaseService } from '@core/services/supabase.service';
import { Usuario, CreateUsuarioDto, UpdateUsuarioDto, RolUsuario } from '../models/usuario.model';

@Injectable({ providedIn: 'root' })
export class UsuarioService {
  private supabase = inject(SupabaseService);

  /**
   * Lista todos los usuarios activos del negocio actual, con su rol en ese negocio.
   * JOIN: usuarios ⟵ usuario_negocios (filtrado por negocio_id del JWT via RLS).
   * Marca al propietario del negocio con `es_propietario = true`.
   */
  async getAll(): Promise<Usuario[]> {
    // Filtro explícito por negocio_id necesario: la RLS de usuario_negocios tiene
    // una cláusula OR que permite ver las propias membresías en todos los negocios
    // (para el selector de login). Sin este filtro, el admin aparece N veces.
    const { data: { user } } = await this.supabase.client.auth.getUser();
    const negocioId = user?.app_metadata?.['negocio_id'] as string | undefined;
    if (!negocioId) return [];

    // Cargo membresias y datos del negocio (para resolver el propietario) en paralelo
    const [membresiaRes, negocioRes] = await Promise.all([
      this.supabase.client
        .from('usuario_negocios')
        .select(`
          id,
          rol,
          activo,
          usuario:usuarios!inner(id, nombre, email, es_superadmin, created_at)
        `)
        .eq('negocio_id', negocioId)
        .order('activo', { ascending: false }),
      this.supabase.client
        .from('negocios')
        .select('propietario_usuario_id')
        .eq('id', negocioId)
        .maybeSingle()
    ]);

    if (membresiaRes.error) return [];

    const propietarioId = (negocioRes.data as any)?.propietario_usuario_id as string | undefined;

    return (membresiaRes.data ?? []).map((row: any) => ({
      membresia_id:   row.id,
      rol:            row.rol,
      activo:         row.activo,
      id:             row.usuario.id,
      nombre:         row.usuario.nombre,
      email:          row.usuario.email,
      es_superadmin:  row.usuario.es_superadmin ?? false,
      created_at:     row.usuario.created_at,
      es_propietario: row.usuario.id === propietarioId
    }));
  }

  /**
   * Cuenta cuántos usuarios con rol ADMIN están activos en el negocio actual.
   * Usado para proteger al último administrador del negocio.
   * Consulta usuario_negocios (filtrado por RLS al negocio activo del JWT).
   */
  async contarAdmins(): Promise<number> {
    const { count, error } = await this.supabase.client
      .from('usuario_negocios')
      .select('*', { count: 'exact', head: true })
      .eq('rol', 'ADMIN')
      .eq('activo', true);

    if (error) return 0;
    return count ?? 0;
  }

  /**
   * Registra un usuario nuevo (INSERT en `usuarios`) y lo vincula al negocio
   * activo con el rol indicado (INSERT en `usuario_negocios`).
   *
   * Si el email ya existe en `usuarios` (fue auto-registrado en otro negocio),
   * solo crea la membresía faltante.
   *
   * Lanza un Error con el mensaje original del backend si falla. La UI captura y traduce.
   */
  async create(dto: CreateUsuarioDto): Promise<Usuario> {
    const { data, error } = await this.supabase.client.rpc('fn_registrar_usuario_negocio', {
      p_nombre: dto.nombre,
      p_email:  dto.email,
      p_rol:    dto.rol
    });

    if (error) throw new Error(error.message);
    if (!data)   throw new Error('No se recibieron datos del servidor.');

    const r = data as any;
    return {
      membresia_id:   r.membresia_id,
      id:             r.usuario_id,
      nombre:         r.nombre,
      email:          r.email,
      es_superadmin:  r.es_superadmin ?? false,
      created_at:     r.created_at,
      rol:            dto.rol,
      activo:         true,
      // Un usuario recien creado nunca es propietario del negocio (el propietario
      // se setea al crear el negocio en fn_completar_onboarding y no cambia).
      es_propietario: false
    };
  }

  /**
   * Transfiere un empleado de la membresía origen a otro negocio destino.
   * Desactiva la membresía en el negocio actual y crea/reactiva en el destino.
   */
  async transferir(membresiaId: string, negocioDestinoId: string, rol: RolUsuario): Promise<boolean> {
    const { error } = await this.supabase.client.rpc('fn_transferir_empleado', {
      p_membresia_id:       membresiaId,
      p_negocio_destino_id: negocioDestinoId,
      p_rol:                rol
    });
    return !error;
  }

  /**
   * Actualiza datos del usuario:
   * - nombre → UPDATE en `usuarios` (campo global, independiente del negocio)
   * - rol / activo → UPDATE en `usuario_negocios` (por negocio)
   *
   * @param usuarioId UUID de la fila en `usuarios`
   * @param membresiaId UUID de la fila en `usuario_negocios`
   * @param dto campos a actualizar
   */
  async update(usuarioId: string, membresiaId: string, dto: UpdateUsuarioDto): Promise<Usuario | null | 'conflict'> {
    const { nombre, rol, activo } = dto;

    // Actualizar nombre en `usuarios` si viene en el DTO
    if (nombre !== undefined) {
      const { error } = await this.supabase.client
        .from('usuarios')
        .update({ nombre })
        .eq('id', usuarioId);

      if (error) return null;
    }

    // Actualizar rol/activo via función SQL (valida conflictos de membresía activa)
    if (rol !== undefined || activo !== undefined) {
      const { error } = await this.supabase.client.rpc('fn_actualizar_membresia', {
        p_membresia_id: membresiaId,
        p_rol:          rol   ?? null,
        p_activo:       activo ?? null
      });

      if (error) {
        // El mensaje de la función incluye el nombre del otro negocio
        if (error.message?.includes('ya está activo en')) return 'conflict';
        return null;
      }
    }

    // Releer el registro actualizado + propietario del negocio
    const { data: { user } } = await this.supabase.client.auth.getUser();
    const negocioId = user?.app_metadata?.['negocio_id'] as string | undefined;

    const [readMembRes, readNegocioRes] = await Promise.all([
      this.supabase.client
        .from('usuario_negocios')
        .select(`
          id,
          rol,
          activo,
          usuario:usuarios!inner(id, nombre, email, es_superadmin, created_at)
        `)
        .eq('id', membresiaId)
        .single(),
      negocioId
        ? this.supabase.client.from('negocios').select('propietario_usuario_id').eq('id', negocioId).maybeSingle()
        : Promise.resolve({ data: null })
    ]);

    if (readMembRes.error || !readMembRes.data) return null;
    const data = readMembRes.data;
    const propietarioId = (readNegocioRes.data as any)?.propietario_usuario_id as string | undefined;

    return {
      membresia_id:   data.id,
      rol:            data.rol,
      activo:         data.activo,
      id:             (data as any).usuario.id,
      nombre:         (data as any).usuario.nombre,
      email:          (data as any).usuario.email,
      es_superadmin:  (data as any).usuario.es_superadmin ?? false,
      created_at:     (data as any).usuario.created_at,
      es_propietario: (data as any).usuario.id === propietarioId
    };
  }
}
