-- ==========================================
-- FUNCION: fn_validar_sesion
-- VERSION: 1.0
-- FECHA: 2026-05-22
-- ==========================================
-- Reemplaza las 2 queries secuenciales de validarUsuario() en AuthService
-- por un unico round-trip a la BD.
--
-- Retorna en un solo JSON:
--   - datos del usuario (id, nombre, email, es_superadmin, activo)
--   - todas sus membresias con nombre del negocio embebido
--
-- Usado SOLO en el slow path de authGuard (primera instalacion, logout,
-- JWT expirado). El fast path (JWT + cache valido) ya no llama a este RPC.
--
-- No requiere p_* parametros — lee el email del JWT via get_email().
-- No bloquea al superadmin (es lectura de datos propios del usuario).
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_validar_sesion()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email    TEXT;
  v_usuario  JSON;
  v_membresias JSON;
BEGIN
  v_email := public.get_email();

  IF v_email IS NULL THEN
    RAISE EXCEPTION 'No hay sesion activa';
  END IF;

  -- Usuario base
  v_usuario := (
    SELECT row_to_json(u)
    FROM (
      SELECT id, nombre, email, es_superadmin, activo
      FROM usuarios
      WHERE email = v_email
    ) u
  );

  IF v_usuario IS NULL THEN
    RETURN json_build_object(
      'usuario',    NULL,
      'membresias', '[]'::json
    );
  END IF;

  -- Todas las membresias (activas e inactivas) con nombre del negocio embebido
  v_membresias := (
    SELECT json_agg(m)
    FROM (
      SELECT
        un.negocio_id,
        un.rol,
        un.activo,
        n.nombre AS negocio_nombre
      FROM usuario_negocios un
      JOIN negocios n ON n.id = un.negocio_id
      WHERE un.usuario_id = (v_usuario->>'id')::uuid
    ) m
  );

  RETURN json_build_object(
    'usuario',    v_usuario,
    'membresias', COALESCE(v_membresias, '[]'::json)
  );
END;
$$;

COMMENT ON FUNCTION public.fn_validar_sesion() IS
'v1.0 - Retorna usuario + membresias en un unico round-trip.
Reemplaza las 2 queries secuenciales de validarUsuario() en AuthService.
Lee el email del JWT via get_email() — sin parametros externos.';

REVOKE EXECUTE ON FUNCTION public.fn_validar_sesion() FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_validar_sesion() TO authenticated;

NOTIFY pgrst, 'reload schema';
