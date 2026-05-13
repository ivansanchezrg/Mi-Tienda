-- =============================================================================
-- fn_transferir_empleado
-- =============================================================================
-- Transfiere un empleado de su negocio actual a otro negocio destino.
-- Desactiva la membresía origen y crea/reactiva la membresía destino.
--
-- Requiere: rol ADMIN en el negocio activo (o ser superadmin).
--
-- v2.0 (2026-05-07) — RETURNS JSON con feedback granular:
--   { success: boolean, mensaje: string, error?: string }
-- =============================================================================

-- DROP firma anterior (cambió tipo de retorno: VOID → JSON)
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
    v_usuario_id   UUID;
    v_negocio_orig UUID;
BEGIN
    -- Solo ADMIN o superadmin pueden transferir
    IF public.get_rol() <> 'ADMIN' AND NOT public.get_es_superadmin() THEN
        RETURN json_build_object('success', false, 'error', 'Acceso denegado');
    END IF;

    v_usuario_id   := (SELECT usuario_id FROM usuario_negocios WHERE id = p_membresia_id);
    v_negocio_orig := (SELECT negocio_id FROM usuario_negocios WHERE id = p_membresia_id);

    IF v_usuario_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Membresía no encontrada');
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

    -- Desactivar membresía origen
    UPDATE usuario_negocios
    SET activo = FALSE
    WHERE id = p_membresia_id;

    -- Crear o reactivar membresía destino
    -- Nota: p_rol se castea a rol_usuario_enum porque la columna es un enum de Postgres.
    --       Pasar TEXT sin cast causa error 42804.
    INSERT INTO usuario_negocios (usuario_id, negocio_id, rol, activo)
    VALUES (v_usuario_id, p_negocio_destino_id, p_rol::rol_usuario_enum, TRUE)
    ON CONFLICT (usuario_id, negocio_id)
    DO UPDATE SET activo = TRUE, rol = EXCLUDED.rol;

    RETURN json_build_object('success', true, 'mensaje', 'Empleado transferido correctamente');

EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_transferir_empleado(UUID, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_transferir_empleado(UUID, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
