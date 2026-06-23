-- =============================================================================
-- fn_transferir_empleado (v3.0)
-- =============================================================================
-- Transfiere un empleado de su negocio actual a otro negocio destino.
-- Desactiva la membresía origen y crea/reactiva la membresía destino.
--
-- v3.0 (2026-05-30) — SEGURIDAD MULTI-TENANT CRÍTICA:
--   Valida que el negocio origen sea el negocio activo del JWT.
--   Sin este check un ADMIN de A podía transferir empleados entre B y C
--   sin tener permisos en ninguno (escalada cross-tenant).
--   Superadmin sigue pudiendo operar sobre cualquier negocio.
--
-- v2.0 — RETURNS JSON con feedback granular:
--   { success: boolean, mensaje: string, error?: string }
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_transferir_empleado(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.fn_transferir_empleado(
    p_membresia_id       UUID,
    p_negocio_destino_id UUID,
    p_rol                TEXT DEFAULT 'EMPLEADO'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_es_superadmin BOOLEAN;
    v_jwt_negocio_id       UUID;
    v_usuario_id           UUID;
    v_negocio_orig         UUID;
BEGIN
    v_caller_es_superadmin := public.get_es_superadmin();
    v_jwt_negocio_id       := public.get_negocio_id();

    -- Solo ADMIN del negocio activo o superadmin pueden transferir
    IF public.get_rol() <> 'ADMIN' AND NOT v_caller_es_superadmin THEN
        RETURN json_build_object('success', false, 'error', 'Acceso denegado');
    END IF;

    v_usuario_id   := (SELECT usuario_id FROM usuario_negocios WHERE id = p_membresia_id);
    v_negocio_orig := (SELECT negocio_id FROM usuario_negocios WHERE id = p_membresia_id);

    IF v_usuario_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Membresía no encontrada');
    END IF;

    -- 🔒 SEGURIDAD MULTI-TENANT: el negocio origen debe ser el activo del JWT,
    -- salvo que el caller sea superadmin (puede operar cross-tenant).
    IF NOT v_caller_es_superadmin AND v_negocio_orig <> v_jwt_negocio_id THEN
        RETURN json_build_object(
            'success', false,
            'error',   'Acceso denegado: no podés transferir empleados de otro negocio'
        );
    END IF;

    -- Solo se puede transferir si la membresía está activa en el negocio origen
    IF NOT (SELECT activo FROM usuario_negocios WHERE id = p_membresia_id) THEN
        RETURN json_build_object(
            'success', false,
            'error',   'El empleado ya está inactivo en este negocio y no puede ser transferido'
        );
    END IF;

    IF v_negocio_orig = p_negocio_destino_id THEN
        RETURN json_build_object('success', false, 'error', 'El negocio destino es el mismo que el origen');
    END IF;

    -- Validar que el negocio destino exista
    IF NOT EXISTS (SELECT 1 FROM negocios WHERE id = p_negocio_destino_id) THEN
        RETURN json_build_object('success', false, 'error', 'Negocio destino no encontrado');
    END IF;

    -- Desactivar membresía origen
    UPDATE usuario_negocios
    SET activo = FALSE
    WHERE id = p_membresia_id;

    -- Crear o reactivar membresía destino
    INSERT INTO usuario_negocios (usuario_id, negocio_id, rol, activo)
    VALUES (v_usuario_id, p_negocio_destino_id, p_rol::rol_usuario_enum, TRUE)
    ON CONFLICT (usuario_id, negocio_id)
    DO UPDATE SET activo = TRUE, rol = EXCLUDED.rol;

    RETURN json_build_object('success', true, 'mensaje', 'Empleado transferido correctamente');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_transferir_empleado(UUID, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_transferir_empleado(UUID, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
