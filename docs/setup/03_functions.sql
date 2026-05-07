-- =============================================================================
-- 03_functions.sql — Funciones de setup global
-- =============================================================================
-- Contiene SOLO las funciones que deben existir antes de que exista cualquier
-- dato de negocio. El resto de funciones viven en sus módulos correspondientes
-- y se ejecutan en el paso 6 del ORDEN_EJECUCION.txt.
--
-- Funciones aquí:
--   fn_set_negocio_activo      — Activa un negocio en el JWT del usuario
--   fn_registrar_usuario_negocio — Registra/vincula un usuario a un negocio
-- =============================================================================

-- =============================================================================
-- fn_set_negocio_activo
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
--   - Valida usuario no suspendido (usuarios.activo)
--   - Valida que el usuario tenga membresia activa en ese negocio
--   - Un superadmin puede activar cualquier negocio (para soporte/admin)
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
    v_email          TEXT;
    v_usuario_id     UUID;
    v_rol            TEXT;
    v_es_superadmin  BOOLEAN;
    v_negocio_nombre VARCHAR;
    v_activo         BOOLEAN;
BEGIN
    v_email := (auth.jwt() ->> 'email');

    IF v_email IS NULL THEN
        RAISE EXCEPTION 'No hay sesion activa. El JWT no contiene email.';
    END IF;

    v_usuario_id    := (SELECT id            FROM usuarios WHERE email = v_email);
    v_es_superadmin := (SELECT es_superadmin FROM usuarios WHERE email = v_email);

    IF v_usuario_id IS NULL THEN
        RAISE EXCEPTION 'Usuario % no encontrado en la tabla de usuarios.', v_email;
    END IF;

    -- Bloquear usuarios suspendidos globalmente (excepto superadmin)
    IF NOT COALESCE(v_es_superadmin, FALSE) THEN
        IF NOT COALESCE((SELECT activo FROM usuarios WHERE id = v_usuario_id), TRUE) THEN
            RAISE EXCEPTION 'El usuario % esta suspendido y no puede acceder a ningun negocio.', v_email;
        END IF;
    END IF;

    -- Verificar que el negocio existe
    v_negocio_nombre := (SELECT nombre FROM negocios WHERE id = p_negocio_id);

    IF v_negocio_nombre IS NULL THEN
        RAISE EXCEPTION 'El negocio % no existe.', p_negocio_id;
    END IF;

    -- Verificar membresia activa (superadmin omite esta validacion)
    IF NOT COALESCE(v_es_superadmin, FALSE) THEN
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

REVOKE EXECUTE ON FUNCTION public.fn_set_negocio_activo(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_set_negocio_activo(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- fn_registrar_usuario_negocio
-- =============================================================================
-- Registra o vincula un usuario existente a un negocio.
-- Llamada desde: UsuariosService al agregar un empleado/admin al equipo.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_registrar_usuario_negocio(
    p_nombre TEXT,
    p_email  TEXT,
    p_rol    TEXT  -- 'ADMIN' | 'EMPLEADO'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id    UUID;
    v_rol_caller    TEXT;
    v_usuario_id    UUID;
    v_membresia_id  UUID;
    v_nombre        TEXT;
    v_email         TEXT;
    v_es_superadmin BOOLEAN;
    v_created_at    TIMESTAMPTZ;
BEGIN
    v_negocio_id := public.get_negocio_id();
    v_rol_caller := auth.jwt() -> 'app_metadata' ->> 'rol';

    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;

    IF v_rol_caller <> 'ADMIN' THEN
        RAISE EXCEPTION 'Solo los administradores pueden registrar usuarios';
    END IF;

    IF p_rol NOT IN ('ADMIN', 'EMPLEADO') THEN
        RAISE EXCEPTION 'Rol inválido: %. Use ADMIN o EMPLEADO', p_rol;
    END IF;

    v_email  := LOWER(TRIM(p_email));
    v_nombre := TRIM(p_nombre);

    IF v_email = '' THEN
        RAISE EXCEPTION 'El email es obligatorio';
    END IF;

    -- Buscar si el usuario ya existe
    v_usuario_id    := (SELECT id             FROM usuarios WHERE email = v_email);
    v_nombre        := COALESCE((SELECT nombre        FROM usuarios WHERE email = v_email), v_nombre);
    v_es_superadmin := COALESCE((SELECT es_superadmin FROM usuarios WHERE email = v_email), FALSE);
    v_created_at    := (SELECT created_at     FROM usuarios WHERE email = v_email);

    IF v_usuario_id IS NULL THEN
        IF v_nombre = '' THEN
            RAISE EXCEPTION 'El usuario con email % no existe en el sistema. Registralo primero con nombre.', v_email;
        END IF;
        v_usuario_id := gen_random_uuid();
        INSERT INTO usuarios (id, nombre, email, es_superadmin)
        VALUES (v_usuario_id, v_nombre, v_email, FALSE);
        v_es_superadmin := FALSE;
        v_created_at    := NOW();
    END IF;

    -- Crear membresía (falla si ya existe en este negocio)
    v_membresia_id := gen_random_uuid();
    INSERT INTO usuario_negocios (id, usuario_id, negocio_id, rol, activo)
    VALUES (v_membresia_id, v_usuario_id, v_negocio_id, p_rol::rol_usuario_enum, TRUE);

    RETURN json_build_object(
        'usuario_id',    v_usuario_id,
        'membresia_id',  v_membresia_id,
        'nombre',        v_nombre,
        'email',         v_email,
        'es_superadmin', v_es_superadmin,
        'created_at',    v_created_at
    );

EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'Este usuario ya pertenece al negocio';
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Error al registrar usuario: %', SQLERRM;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_registrar_usuario_negocio(TEXT, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_registrar_usuario_negocio(TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
