-- =============================================================================
-- fn_consultar_usuario_por_email — Consulta minima sobre un email para el wizard de creacion de negocio
-- =============================================================================
-- Usado desde el frontend cuando el superadmin escribe el email del admin del
-- nuevo negocio. Permite saber si el usuario ya existe (para reusar el registro)
-- o si es nuevo (para pedir el nombre).
--
-- v1.1 (2026-05-04): ahora tambien retorna la lista de negocios donde el usuario
-- tiene membresia activa, para que el superadmin pueda confirmar la identidad
-- antes de agregarle una sucursal nueva.
--
-- Solo retorna: existe, nombre y la lista de negocios. NO retorna id,
-- es_superadmin, created_at ni nada que pueda usarse para enumerar usuarios.
--
-- Restriccion: solo el superadmin puede ejecutarla. Un admin comun no necesita
-- esta funcion (en sucursales hereda al propietario, no pide email).
--
-- Parametros:
--   p_email TEXT — email a consultar
--
-- Retorna JSON:
--   {
--     existe: bool,
--     nombre: text | null,
--     negocios: [
--       { nombre: text, rol: 'ADMIN'|'EMPLEADO', es_propietario: bool }
--     ]  -- vacio si el usuario no tiene membresias activas
--   }
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_consultar_usuario_por_email(TEXT);

CREATE OR REPLACE FUNCTION public.fn_consultar_usuario_por_email(
    p_email TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_email   TEXT;
    v_es_superadmin  BOOLEAN;
    v_usuario_id     UUID;
    v_nombre         TEXT;
    v_email_norm     TEXT;
    v_negocios       JSON;
BEGIN
    v_caller_email := (auth.jwt() ->> 'email');

    IF v_caller_email IS NULL THEN
        RAISE EXCEPTION 'No hay sesion activa';
    END IF;

    v_es_superadmin := COALESCE(
        (SELECT es_superadmin FROM usuarios WHERE email = v_caller_email),
        FALSE
    );

    IF NOT v_es_superadmin THEN
        RAISE EXCEPTION 'Solo el superadmin puede consultar usuarios';
    END IF;

    -- Validar formato basico
    v_email_norm := LOWER(TRIM(p_email));
    IF v_email_norm = '' OR v_email_norm IS NULL THEN
        RAISE EXCEPTION 'Email no puede estar vacio';
    END IF;

    -- Buscar usuario (id + nombre — no devolvemos es_superadmin ni created_at)
    v_usuario_id := (SELECT id     FROM usuarios WHERE email = v_email_norm);
    v_nombre     := (SELECT nombre FROM usuarios WHERE email = v_email_norm);

    -- Si existe, traer negocios donde tiene membresia activa
    IF v_usuario_id IS NOT NULL THEN
        v_negocios := COALESCE(
            (
                SELECT json_agg(
                    json_build_object(
                        'nombre',         n.nombre,
                        'rol',            un.rol,
                        'es_propietario', (n.propietario_usuario_id = v_usuario_id)
                    )
                    ORDER BY n.created_at
                )
                FROM usuario_negocios un
                JOIN negocios n ON n.id = un.negocio_id
                WHERE un.usuario_id = v_usuario_id
                  AND un.activo     = TRUE
            ),
            '[]'::JSON
        );
    ELSE
        v_negocios := '[]'::JSON;
    END IF;

    RETURN json_build_object(
        'existe',   v_usuario_id IS NOT NULL,
        'nombre',   v_nombre,
        'negocios', v_negocios
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_consultar_usuario_por_email(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_consultar_usuario_por_email(TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_consultar_usuario_por_email(TEXT) TO authenticated;
-- Nota: aunque se concede a authenticated, la funcion valida que el caller
-- sea superadmin. Cualquier otro rol recibe RAISE EXCEPTION.

NOTIFY pgrst, 'reload schema';
