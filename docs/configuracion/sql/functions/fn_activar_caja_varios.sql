-- =============================================================================
-- fn_activar_caja_varios — Activa la caja Varios del negocio activo
-- =============================================================================
-- Solo puede ejecutarla un ADMIN (rol en JWT).
-- Si la caja VARIOS ya existe, no la duplica (idempotente).
-- Actualiza la configuracion caja_varios_activa = 'true'.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_activar_caja_varios()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id UUID;
    v_rol        TEXT;
BEGIN
    v_negocio_id := get_negocio_id();
    v_rol        := (auth.jwt() -> 'app_metadata' ->> 'rol');

    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;

    IF v_rol IS DISTINCT FROM 'ADMIN' THEN
        RAISE EXCEPTION 'Solo un administrador puede activar la caja Varios';
    END IF;

    -- Crear la caja si no existe
    INSERT INTO cajas (negocio_id, codigo, nombre, descripcion, saldo_actual)
    VALUES (v_negocio_id, 'VARIOS', 'Varios', 'Fondo fijo de emergencia', 0)
    ON CONFLICT (negocio_id, codigo) DO NOTHING;

    -- Marcar como activa en configuraciones
    INSERT INTO configuraciones (negocio_id, clave, valor)
    VALUES (v_negocio_id, 'caja_varios_activa', 'true')
    ON CONFLICT (negocio_id, clave) DO UPDATE SET valor = 'true';

    RETURN json_build_object('success', TRUE);

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al activar caja Varios: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_activar_caja_varios() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_activar_caja_varios() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_activar_caja_varios() TO authenticated;

NOTIFY pgrst, 'reload schema';
