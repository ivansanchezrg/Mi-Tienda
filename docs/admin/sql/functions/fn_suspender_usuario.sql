-- =============================================================================
-- fn_suspender_usuario — Suspender/reactivar un usuario globalmente
-- =============================================================================
-- Suspender un usuario impide que entre a CUALQUIER negocio de la plataforma,
-- independientemente de cuantos negocios tenga. La validacion ocurre en
-- fn_set_negocio_activo que verifica usuarios.activo antes de emitir el JWT.
--
-- El superadmin nunca puede suspenderse a si mismo ni a otro superadmin.
--
-- Parametros:
--   p_usuario_id UUID    — ID del usuario a suspender/reactivar
--   p_activo     BOOLEAN — TRUE para reactivar, FALSE para suspender
--
-- Retorna: JSON con { success, usuario_id, activo, nombre, email }
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_suspender_usuario(UUID, BOOLEAN);

CREATE OR REPLACE FUNCTION public.fn_suspender_usuario(
    p_usuario_id UUID,
    p_activo     BOOLEAN
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_email         TEXT;
    v_caller_es_superadmin BOOLEAN;
    v_usuario_nombre       TEXT;
    v_usuario_email        TEXT;
    v_es_superadmin_target BOOLEAN;
BEGIN
    v_caller_email := (auth.jwt() ->> 'email');

    IF v_caller_email IS NULL THEN
        RAISE EXCEPTION 'No hay sesion activa';
    END IF;

    v_caller_es_superadmin := COALESCE(
        (SELECT es_superadmin FROM usuarios WHERE email = v_caller_email),
        FALSE
    );

    IF NOT v_caller_es_superadmin THEN
        RAISE EXCEPTION 'Solo el superadmin puede suspender o reactivar usuarios';
    END IF;

    -- Obtener datos del usuario objetivo
    v_usuario_nombre       := (SELECT nombre       FROM usuarios WHERE id = p_usuario_id);
    v_usuario_email        := (SELECT email        FROM usuarios WHERE id = p_usuario_id);
    v_es_superadmin_target := (SELECT es_superadmin FROM usuarios WHERE id = p_usuario_id);

    IF v_usuario_nombre IS NULL THEN
        RAISE EXCEPTION 'El usuario no existe';
    END IF;

    -- No permitir suspender superadmins
    IF COALESCE(v_es_superadmin_target, FALSE) THEN
        RAISE EXCEPTION 'No se puede suspender a un superadmin';
    END IF;

    -- No permitir que el superadmin se suspenda a si mismo
    IF v_usuario_email = v_caller_email THEN
        RAISE EXCEPTION 'No puedes suspenderte a ti mismo';
    END IF;

    UPDATE usuarios SET activo = p_activo WHERE id = p_usuario_id;

    RETURN json_build_object(
        'success',    TRUE,
        'usuario_id', p_usuario_id,
        'nombre',     v_usuario_nombre,
        'email',      v_usuario_email,
        'activo',     p_activo
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_suspender_usuario(UUID, BOOLEAN) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_suspender_usuario(UUID, BOOLEAN) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_suspender_usuario(UUID, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
