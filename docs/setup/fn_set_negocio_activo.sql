-- =============================================================================
-- fn_set_negocio_activo — Activar un negocio en el JWT del usuario
-- =============================================================================
-- Establece negocio_id y rol en app_metadata del JWT de auth.users.
-- El frontend llama a esta funcion cuando el usuario selecciona un negocio
-- en la pantalla de seleccion (multi-tenant login flow).
--
-- Tras la llamada, el cliente debe hacer supabase.auth.refreshSession()
-- para que el nuevo JWT con los claims actualizados entre en vigor.
--
-- Parametros:
--   p_negocio_id  UUID  — ID del negocio a activar
--
-- Retorna: JSON con { success, negocio_id, rol, negocio_nombre }
--
-- Seguridad:
--   - SECURITY DEFINER para poder actualizar auth.users.raw_app_meta_data
--   - Valida que el usuario autenticado tenga membresia activa en ese negocio
--   - Un superadmin puede activar cualquier negocio (para soporte/admin)
--
-- CORRECCIONES v1.1:
--   - Fix Supabase: SELECT rol, activo INTO v_rol, v_activo → dos asignaciones := (SELECT ...)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_set_negocio_activo(
    p_negocio_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email         TEXT;
    v_usuario_id    UUID;
    v_rol           TEXT;
    v_es_superadmin BOOLEAN;
    v_negocio_nombre VARCHAR;
    v_activo        BOOLEAN;
BEGIN
    -- Obtener email del usuario autenticado desde el JWT
    v_email := (auth.jwt() ->> 'email');

    IF v_email IS NULL THEN
        RAISE EXCEPTION 'No hay sesion activa. El JWT no contiene email.';
    END IF;

    -- Obtener datos del usuario en la tabla publica
    -- Fix: dos := (SELECT ...) en vez de SELECT ... INTO variable (bug Supabase)
    v_usuario_id    := (SELECT id            FROM usuarios WHERE email = v_email);
    v_es_superadmin := (SELECT es_superadmin FROM usuarios WHERE email = v_email);

    IF v_usuario_id IS NULL THEN
        RAISE EXCEPTION 'Usuario % no encontrado en la tabla de usuarios.', v_email;
    END IF;

    -- Verificar que el negocio existe
    v_negocio_nombre := (SELECT nombre FROM negocios WHERE id = p_negocio_id AND activo = TRUE);

    IF v_negocio_nombre IS NULL THEN
        RAISE EXCEPTION 'El negocio % no existe o no esta activo.', p_negocio_id;
    END IF;

    -- Verificar membresia activa (superadmin omite esta validacion)
    IF NOT COALESCE(v_es_superadmin, FALSE) THEN
        -- Fix: dos := (SELECT ...) en vez de SELECT ... INTO v_rol, v_activo (bug Supabase)
        v_rol    := (SELECT rol    FROM usuario_negocios WHERE usuario_id = v_usuario_id AND negocio_id = p_negocio_id);
        v_activo := (SELECT activo FROM usuario_negocios WHERE usuario_id = v_usuario_id AND negocio_id = p_negocio_id);

        IF v_rol IS NULL THEN
            RAISE EXCEPTION 'El usuario % no tiene membresia en el negocio %.', v_email, p_negocio_id;
        END IF;

        IF NOT v_activo THEN
            RAISE EXCEPTION 'La membresia del usuario % en el negocio % esta inactiva.', v_email, p_negocio_id;
        END IF;
    ELSE
        -- Superadmin: si tiene membresia la usa, si no tiene se asigna ADMIN virtual
        v_rol := COALESCE(
            (SELECT rol FROM usuario_negocios
             WHERE usuario_id = v_usuario_id AND negocio_id = p_negocio_id AND activo = TRUE),
            'ADMIN'
        );
    END IF;

    -- Actualizar app_metadata en auth.users
    -- Esto actualiza el JWT en el proximo refresh de sesion
    UPDATE auth.users
    SET raw_app_meta_data = raw_app_meta_data
        || jsonb_build_object(
            'negocio_id',    p_negocio_id::TEXT,
            'rol',           v_rol,
            'es_superadmin', COALESCE(v_es_superadmin, FALSE)
        )
    WHERE email = v_email;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se pudo actualizar el JWT del usuario %. El usuario no existe en auth.users.', v_email;
    END IF;

    RETURN json_build_object(
        'success',         TRUE,
        'negocio_id',      p_negocio_id,
        'rol',             v_rol,
        'negocio_nombre',  v_negocio_nombre,
        'mensaje',         'Negocio activado. Llamar a supabase.auth.refreshSession() para aplicar el nuevo JWT.'
    );

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al activar negocio: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

-- Cualquier usuario autenticado puede llamar esta funcion para seleccionar SU negocio.
-- La funcion valida internamente que tenga membresia activa.
REVOKE EXECUTE ON FUNCTION public.fn_set_negocio_activo(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_set_negocio_activo(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- FLUJO DE USO (frontend Angular/TypeScript):
--
-- 1. Login con supabase.auth.signInWithOAuth({ provider: 'google' })
--    → JWT inicial: sin negocio_id (auth.negocio_id() devuelve NULL)
--
-- 2. Obtener negocios del usuario:
--    SELECT un.negocio_id, n.nombre FROM usuario_negocios un
--    INNER JOIN negocios n ON n.id = un.negocio_id
--    WHERE un.usuario_id = <usuario_id> AND un.activo = TRUE
--    → Si solo hay 1, seleccionar automaticamente.
--    → Si hay varios, mostrar pantalla de seleccion.
--
-- 3. Activar negocio:
--    await supabase.rpc('fn_set_negocio_activo', { p_negocio_id: negocioId });
--
-- 4. Refrescar sesion para obtener JWT actualizado:
--    await supabase.auth.refreshSession();
--    → Ahora public.get_negocio_id() devuelve el UUID del negocio seleccionado
--    → RLS filtra automaticamente por ese negocio en todas las queries
--
-- 5. Navegar al home de la app.
-- =============================================================================
