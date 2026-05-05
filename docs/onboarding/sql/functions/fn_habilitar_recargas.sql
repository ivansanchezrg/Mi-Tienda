-- =============================================================================
-- fn_habilitar_recargas — Activa o desactiva Celular y/o Bus para un negocio
-- =============================================================================
-- Solo puede ejecutarlo el superadmin.
-- Idempotente: crea las cajas/categorías si no existen (ON CONFLICT DO NOTHING).
-- Opera sobre el negocio activo del JWT — no acepta negocio_id externo.
--
-- Parámetros:
--   p_celular   BOOLEAN  — true = activar, false = desactivar
--   p_bus       BOOLEAN  — true = activar, false = desactivar
--
-- Retorna: JSON con { success }
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_habilitar_recargas(
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
        RAISE EXCEPTION 'Solo el superadmin puede habilitar módulos';
    END IF;

    v_negocio_id := (auth.jwt() -> 'app_metadata' ->> 'negocio_id')::UUID;
    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;

    -- ── Módulo CELULAR ──
    IF p_celular THEN
        INSERT INTO cajas (negocio_id, codigo, nombre, descripcion, saldo_actual)
        VALUES (v_negocio_id, 'CAJA_CELULAR', 'Celular', 'Efectivo recargas celular', 0)
        ON CONFLICT (negocio_id, codigo) DO NOTHING;

        INSERT INTO categorias_operaciones (negocio_id, nombre, tipo, descripcion, seleccionable)
        VALUES (v_negocio_id, 'Pago Proveedor Recargas', 'EGRESO', 'Pago al proveedor de recargas celular (saldo prestado a credito)', FALSE)
        ON CONFLICT DO NOTHING;
    END IF;

    -- ── Módulo BUS ──
    IF p_bus THEN
        INSERT INTO cajas (negocio_id, codigo, nombre, descripcion, saldo_actual)
        VALUES (v_negocio_id, 'CAJA_BUS', 'Bus', 'Efectivo recargas bus', 0)
        ON CONFLICT (negocio_id, codigo) DO NOTHING;

        INSERT INTO categorias_operaciones (negocio_id, nombre, tipo, descripcion, seleccionable)
        VALUES (v_negocio_id, 'Compra Saldo Virtual Bus', 'EGRESO', 'Compra de saldo virtual bus mediante deposito bancario', FALSE)
        ON CONFLICT DO NOTHING;

        -- Config de bus solo si se activa por primera vez
        INSERT INTO configuraciones (negocio_id, clave, valor) VALUES
        (v_negocio_id, 'bus_alerta_saldo_bajo',      '10'),
        (v_negocio_id, 'bus_dias_antes_facturacion', '3')
        ON CONFLICT (negocio_id, clave) DO NOTHING;
    END IF;

    -- ── Flags de configuración (siempre actualizar) ──
    INSERT INTO configuraciones (negocio_id, clave, valor) VALUES
    (v_negocio_id, 'recargas_celular_habilitada', p_celular::TEXT),
    (v_negocio_id, 'recargas_bus_habilitada',     p_bus::TEXT)
    ON CONFLICT (negocio_id, clave) DO UPDATE SET valor = EXCLUDED.valor;

    RETURN json_build_object('success', TRUE);

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al configurar módulos de recargas: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_habilitar_recargas(BOOLEAN, BOOLEAN) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_habilitar_recargas(BOOLEAN, BOOLEAN) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_habilitar_recargas(BOOLEAN, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';
