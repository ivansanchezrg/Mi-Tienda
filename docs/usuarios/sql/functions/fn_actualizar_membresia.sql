-- =============================================================================
-- fn_actualizar_membresia
-- =============================================================================
-- Actualiza rol y/o activo de una membresía (usuario_negocios).
-- Reemplaza el UPDATE directo desde el cliente para poder validar que al
-- reactivar un empleado no esté ya activo en otro negocio.
--
-- Retorna el registro actualizado (id, rol, activo).
-- Requiere: rol ADMIN en el negocio activo (o ser superadmin).
--
-- Validaciones:
--   - Si activo pasa de FALSE → TRUE: verifica que el usuario no tenga
--     otra membresía activa en un negocio distinto. Si la tiene, lanza excepción.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_actualizar_membresia(
    p_membresia_id UUID,
    p_rol          TEXT    DEFAULT NULL,
    p_activo       BOOLEAN DEFAULT NULL
)
RETURNS TABLE(id UUID, rol rol_usuario_enum, activo BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usuario_id    UUID;
    v_negocio_id    UUID;
    v_activo_actual BOOLEAN;
    v_otro_negocio  TEXT;
BEGIN
    IF public.get_rol() <> 'ADMIN' AND NOT public.get_es_superadmin() THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    -- Leer estado actual de la membresía
    v_usuario_id    := (SELECT usuario_id FROM usuario_negocios WHERE usuario_negocios.id = p_membresia_id);
    v_negocio_id    := (SELECT negocio_id FROM usuario_negocios WHERE usuario_negocios.id = p_membresia_id);
    v_activo_actual := (SELECT usuario_negocios.activo FROM usuario_negocios WHERE usuario_negocios.id = p_membresia_id);

    IF v_usuario_id IS NULL THEN
        RAISE EXCEPTION 'Membresía no encontrada';
    END IF;

    -- Si se está reactivando (FALSE → TRUE), verificar que no esté activo en otro negocio
    IF p_activo = TRUE AND v_activo_actual = FALSE THEN
        v_otro_negocio := (
            SELECT n.nombre
            FROM usuario_negocios un
            JOIN negocios n ON n.id = un.negocio_id
            WHERE un.usuario_id = v_usuario_id
              AND un.negocio_id <> v_negocio_id
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

    -- Retornar registro actualizado
    RETURN QUERY
    SELECT un.id, un.rol, un.activo
    FROM usuario_negocios un
    WHERE un.id = p_membresia_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_actualizar_membresia(UUID, TEXT, BOOLEAN) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_actualizar_membresia(UUID, TEXT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
