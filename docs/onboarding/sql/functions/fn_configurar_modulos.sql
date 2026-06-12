-- =============================================================================
-- fn_configurar_modulos — Activa o desactiva módulos para el negocio activo
-- =============================================================================
-- Solo puede ejecutarlo el superadmin (operando dentro del negocio via JWT).
-- Idempotente: crea cajas/categorías si no existen (ON CONFLICT DO NOTHING).
-- Opera sobre el negocio activo del JWT — no acepta negocio_id externo.
--
-- 2026-06-11: la Caja Varios ya NO se gestiona aquí — pasó a potestad del
-- ADMIN del negocio via fn_configurar_caja_varios (reversible, con salvaguarda
-- de saldo). Esta función queda solo para los módulos de plataforma
-- CELULAR y BUS. Firma anterior (con p_varios) eliminada.
--
-- Parámetros:
--   p_celular  BOOLEAN  — true = activar, false = desactivar
--   p_bus      BOOLEAN  — true = activar, false = desactivar
--
-- Retorna: JSON con { success }
-- =============================================================================

-- Eliminar firmas anteriores
DROP FUNCTION IF EXISTS public.fn_habilitar_recargas(BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.fn_habilitar_recargas(BOOLEAN, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.fn_configurar_modulos(BOOLEAN, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.fn_configurar_modulos(BOOLEAN, BOOLEAN, BOOLEAN, DECIMAL);

CREATE OR REPLACE FUNCTION public.fn_configurar_modulos(
    p_celular BOOLEAN,
    p_bus     BOOLEAN
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id UUID;
BEGIN
    -- Solo superadmin puede ejecutar esta función
    IF NOT EXISTS (
        SELECT 1 FROM usuarios WHERE email = (auth.jwt() ->> 'email') AND es_superadmin = TRUE
    ) THEN
        RAISE EXCEPTION 'Solo el superadmin puede configurar módulos';
    END IF;

    v_negocio_id := (auth.jwt() -> 'app_metadata' ->> 'negocio_id')::UUID;
    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;

    -- ── Módulo CELULAR ──
    IF p_celular THEN
        INSERT INTO cajas (negocio_id, codigo, nombre, descripcion, saldo_actual, puede_tener_turno, icono, color)
        VALUES (v_negocio_id, 'CAJA_CELULAR', 'Celular', 'Efectivo recargas celular', 0, FALSE, 'phone-portrait-outline', '#3dc2ff')
        ON CONFLICT (negocio_id, codigo) DO NOTHING;

        -- Categoría de sistema PAGO-PROV-CEL ya existe en categorias_sistema (global).
        -- No se crea por negocio.
    END IF;

    -- ── Módulo BUS ──
    IF p_bus THEN
        INSERT INTO cajas (negocio_id, codigo, nombre, descripcion, saldo_actual, puede_tener_turno, icono, color)
        VALUES (v_negocio_id, 'CAJA_BUS', 'Bus', 'Efectivo recargas bus', 0, FALSE, 'bus-outline', '#ffc409')
        ON CONFLICT (negocio_id, codigo) DO NOTHING;

        -- Categoría de sistema COMPRA-BUS ya existe en categorias_sistema (global).
        -- No se crea por negocio.

        INSERT INTO configuraciones (negocio_id, clave, valor) VALUES
        (v_negocio_id, 'bus_alerta_saldo_bajo',      '10'),
        (v_negocio_id, 'bus_dias_antes_facturacion', '3')
        ON CONFLICT (negocio_id, clave) DO NOTHING;
    END IF;

    -- ── Flags de configuración ──
    INSERT INTO configuraciones (negocio_id, clave, valor) VALUES
    (v_negocio_id, 'recargas_celular_habilitada', p_celular::TEXT),
    (v_negocio_id, 'recargas_bus_habilitada',     p_bus::TEXT)
    ON CONFLICT (negocio_id, clave) DO UPDATE SET valor = EXCLUDED.valor;

    RETURN json_build_object('success', TRUE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_configurar_modulos(BOOLEAN, BOOLEAN) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_configurar_modulos(BOOLEAN, BOOLEAN) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_configurar_modulos(BOOLEAN, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
