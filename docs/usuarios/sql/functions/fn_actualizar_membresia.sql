-- =============================================================================
-- fn_actualizar_membresia (v2.1)
-- =============================================================================
-- Actualiza rol y/o activo de una membresía (usuario_negocios).
-- Reemplaza el UPDATE directo desde el cliente para poder validar que al
-- reactivar un empleado no esté ya activo en otro negocio.
--
-- v2.1 (2026-06-24) — FIX: column reference "id" is ambiguous (SQLSTATE 42702).
--   Las columnas de salida del RETURNS TABLE (id/rol/activo) colisionaban con
--   las columnas de usuario_negocios en el RETURN QUERY → la función fallaba con
--   400 Bad Request y editar usuario no funcionaba. Renombradas a out_*.
-- v2.0 (2026-05-30) — SEGURIDAD MULTI-TENANT CRÍTICA:
--   Valida que la membresía pertenezca al negocio activo del JWT.
--   Sin este check un ADMIN del negocio A podía cambiar rol/activo de
--   membresías del negocio B (escalada de privilegios cross-tenant).
--   Superadmin sigue pudiendo operar sobre cualquier negocio.
--
-- Retorna el registro actualizado (id, rol, activo).
-- Requiere: rol ADMIN en el negocio activo (o ser superadmin).
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_actualizar_membresia(UUID, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.fn_actualizar_membresia(
    p_membresia_id UUID,
    p_rol          TEXT    DEFAULT NULL,
    p_activo       BOOLEAN DEFAULT NULL
)
RETURNS TABLE(out_id UUID, out_rol rol_usuario_enum, out_activo BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_es_superadmin BOOLEAN;
    v_jwt_negocio_id       UUID;
    v_usuario_id           UUID;
    v_mem_negocio_id       UUID;
    v_activo_actual        BOOLEAN;
    v_otro_negocio         TEXT;
BEGIN
    v_caller_es_superadmin := public.get_es_superadmin();
    v_jwt_negocio_id       := public.get_negocio_id();

    -- Solo ADMIN del negocio o superadmin pueden ejecutar
    IF public.get_rol() <> 'ADMIN' AND NOT v_caller_es_superadmin THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    -- Leer la membresía
    v_usuario_id     := (SELECT usuario_id FROM usuario_negocios WHERE id = p_membresia_id);
    v_mem_negocio_id := (SELECT negocio_id FROM usuario_negocios WHERE id = p_membresia_id);
    v_activo_actual  := (SELECT activo     FROM usuario_negocios WHERE id = p_membresia_id);

    IF v_usuario_id IS NULL THEN
        RAISE EXCEPTION 'Membresía no encontrada';
    END IF;

    -- 🔒 SEGURIDAD MULTI-TENANT: la membresía debe pertenecer al negocio activo,
    -- salvo que el caller sea superadmin (que puede operar fuera de su negocio).
    IF NOT v_caller_es_superadmin AND v_mem_negocio_id <> v_jwt_negocio_id THEN
        RAISE EXCEPTION 'Acceso denegado: la membresía no pertenece al negocio activo';
    END IF;

    -- Si se está reactivando (FALSE → TRUE), verificar que no esté activo en otro negocio
    IF p_activo = TRUE AND v_activo_actual = FALSE THEN
        v_otro_negocio := (
            SELECT n.nombre
            FROM usuario_negocios un
            JOIN negocios n ON n.id = un.negocio_id
            WHERE un.usuario_id = v_usuario_id
              AND un.negocio_id <> v_mem_negocio_id
              AND un.activo = TRUE
            LIMIT 1
        );

        IF v_otro_negocio IS NOT NULL THEN
            RAISE EXCEPTION 'El empleado ya está activo en "%". Transferilo desde ese negocio para activarlo aquí.', v_otro_negocio;
        END IF;
    END IF;

    -- Aplicar cambios (solo los campos que vienen non-null)
    UPDATE usuario_negocios un
    SET
        rol    = COALESCE(p_rol::rol_usuario_enum, un.rol),
        activo = COALESCE(p_activo, un.activo)
    WHERE un.id = p_membresia_id;

    -- Retornar registro actualizado.
    -- Las columnas de salida se llaman out_* (no id/rol/activo) para no colisionar
    -- con las columnas homónimas de usuario_negocios — calificar con `un.` no basta,
    -- el nombre de la columna de salida sigue siendo ambiguo (SQLSTATE 42702).
    RETURN QUERY
    SELECT un.id, un.rol, un.activo
    FROM usuario_negocios AS un
    WHERE un.id = p_membresia_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_actualizar_membresia(UUID, TEXT, BOOLEAN) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_actualizar_membresia(UUID, TEXT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
