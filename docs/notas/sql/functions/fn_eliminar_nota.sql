-- ============================================================
-- fn_eliminar_nota
-- Elimina una nota solo si el usuario autenticado tiene rol ADMIN.
-- El rol se verifica desde el JWT (auth.jwt()), no desde parámetros
-- del frontend — así no es manipulable desde el cliente.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_eliminar_nota(
    p_nota_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rol     rol_usuario_enum;
    v_email   TEXT;
BEGIN
    -- Obtener el email del usuario autenticado desde el JWT
    v_email := auth.jwt() ->> 'email';

    IF v_email IS NULL THEN
        RAISE EXCEPTION 'No autenticado';
    END IF;

    -- Verificar rol desde la tabla usuarios usando el email del JWT
    v_rol := (SELECT rol FROM usuarios WHERE usuario = v_email AND activo = true);

    IF v_rol IS NULL THEN
        RAISE EXCEPTION 'Usuario no encontrado o inactivo';
    END IF;

    -- Solo ADMIN puede eliminar notas
    IF v_rol <> 'ADMIN' THEN
        RAISE EXCEPTION 'Sin permisos para eliminar notas';
    END IF;

    -- Eliminar la nota
    DELETE FROM notas WHERE id = p_nota_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nota no encontrada';
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_eliminar_nota(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_eliminar_nota(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
