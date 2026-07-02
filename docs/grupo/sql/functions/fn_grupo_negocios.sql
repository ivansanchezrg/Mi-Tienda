-- ==========================================
-- fn_grupo_negocios (v1.0 — 2026-07-01)
-- ==========================================
-- Devuelve la lista de negocios de los que el usuario autenticado es PROPIETARIO
-- (negocios.propietario_usuario_id = <usuario del JWT>).
--
-- Es la piedra angular de la "Vista de grupo" (Resumen general multi-sucursal):
--   • Gate natural del plan MAX: si devuelve 2+ negocios, el frontend muestra la
--     vista; si devuelve 0 o 1, no hay nada que consolidar y no se muestra.
--   • Fuente de la lista blanca de negocio_id que consumen las demás funciones
--     fn_grupo_* para agregar datos sin exponer negocios ajenos.
--
-- SEGURIDAD (crítico): SECURITY DEFINER bypassa RLS. La función NO recibe
-- negocio_id del cliente — resuelve el propietario internamente desde el JWT
-- (get_email() → usuarios.id) y filtra por propietario_usuario_id. Un usuario
-- solo puede ver SUS negocios; nunca los de otro propietario. Mismo mecanismo de
-- confianza que ya usa la RLS de `negocios` para el superadmin, aquí aplicado a
-- "ser el dueño".
--
-- No lleva fn_assert_no_superadmin: es lectura pura. El superadmin no es
-- propietario de ningún negocio (propietario_usuario_id nunca apunta a él en el
-- flujo normal), así que naturalmente recibe lista vacía — correcto.
--
-- LANGUAGE plpgsql STABLE: lectura pura.
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_grupo_negocios();

CREATE OR REPLACE FUNCTION public.fn_grupo_negocios()
RETURNS TABLE (
    negocio_id   UUID,
    nombre       VARCHAR,
    slug         VARCHAR
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usuario_id UUID;
BEGIN
    -- Resolver el usuario autenticado desde el JWT (nunca desde un parámetro)
    v_usuario_id := (SELECT id FROM usuarios WHERE email = public.get_email());

    IF v_usuario_id IS NULL THEN
        RETURN;  -- sin usuario resuelto → lista vacía
    END IF;

    RETURN QUERY
        SELECT n.id, n.nombre, n.slug
        FROM negocios n
        WHERE n.propietario_usuario_id = v_usuario_id
        ORDER BY n.nombre;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_grupo_negocios() FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_grupo_negocios() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_grupo_negocios IS
'v1.0 — Lista de negocios donde el usuario autenticado es propietario. Gate y
lista blanca de la Vista de grupo (Resumen general multi-sucursal). SECURITY
DEFINER: resuelve el propietario del JWT internamente, nunca recibe negocio_id.';
