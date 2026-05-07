-- =============================================================================
-- fn_configurar_modulos_admin — Activa o desactiva módulos para un negocio
-- específico, operado remotamente por el superadmin desde /admin.
-- =============================================================================
-- Diferencia con fn_configurar_modulos: acepta p_negocio_id explícito en lugar
-- de leerlo del JWT. Permite al superadmin configurar cualquier negocio sin
-- necesidad de entrar a él (cambiar el JWT).
--
-- Parámetros:
--   p_negocio_id    UUID           — negocio a configurar
--   p_celular       BOOLEAN        — true = activar, false = desactivar
--   p_bus           BOOLEAN        — true = activar, false = desactivar
--   p_varios        BOOLEAN        — true = activar (irreversible), false = sin cambio
--   p_varios_monto  DECIMAL(12,2)  — monto diario a transferir a VARIOS al cierre (requerido si p_varios = true)
--
-- Retorna: JSON con { success }
-- =============================================================================

-- Eliminar función anterior (nombre viejo y firma sin monto)
DROP FUNCTION IF EXISTS public.fn_habilitar_recargas_admin(UUID, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.fn_configurar_modulos_admin(UUID, BOOLEAN, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION public.fn_configurar_modulos_admin(
    p_negocio_id   UUID,
    p_celular      BOOLEAN,
    p_bus          BOOLEAN,
    p_varios       BOOLEAN          DEFAULT FALSE,
    p_varios_monto DECIMAL(12,2)    DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Solo superadmin puede ejecutar esta función
    IF NOT EXISTS (
        SELECT 1 FROM usuarios WHERE email = (auth.jwt() ->> 'email') AND es_superadmin = TRUE
    ) THEN
        RAISE EXCEPTION 'Solo el superadmin puede configurar módulos';
    END IF;

    IF p_negocio_id IS NULL THEN
        RAISE EXCEPTION 'p_negocio_id es requerido';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM negocios WHERE id = p_negocio_id) THEN
        RAISE EXCEPTION 'El negocio no existe';
    END IF;

    -- ── Módulo CELULAR ──
    IF p_celular THEN
        INSERT INTO cajas (negocio_id, codigo, nombre, descripcion, saldo_actual)
        VALUES (p_negocio_id, 'CAJA_CELULAR', 'Celular', 'Efectivo recargas celular', 0)
        ON CONFLICT (negocio_id, codigo) DO NOTHING;

        INSERT INTO categorias_operaciones (negocio_id, nombre, tipo, descripcion, seleccionable)
        VALUES (p_negocio_id, 'Pago Proveedor Recargas', 'EGRESO', 'Pago al proveedor de recargas celular (saldo prestado a credito)', FALSE)
        ON CONFLICT DO NOTHING;
    END IF;

    -- ── Módulo BUS ──
    IF p_bus THEN
        INSERT INTO cajas (negocio_id, codigo, nombre, descripcion, saldo_actual)
        VALUES (p_negocio_id, 'CAJA_BUS', 'Bus', 'Efectivo recargas bus', 0)
        ON CONFLICT (negocio_id, codigo) DO NOTHING;

        INSERT INTO categorias_operaciones (negocio_id, nombre, tipo, descripcion, seleccionable)
        VALUES (p_negocio_id, 'Compra Saldo Virtual Bus', 'EGRESO', 'Compra de saldo virtual bus mediante deposito bancario', FALSE)
        ON CONFLICT DO NOTHING;

        INSERT INTO configuraciones (negocio_id, clave, valor) VALUES
        (p_negocio_id, 'bus_alerta_saldo_bajo',      '10'),
        (p_negocio_id, 'bus_dias_antes_facturacion', '3')
        ON CONFLICT (negocio_id, clave) DO NOTHING;
    END IF;

    -- ── Módulo VARIOS (irreversible: solo se activa, nunca se desactiva) ──
    IF p_varios THEN
        IF p_varios_monto IS NULL OR p_varios_monto <= 0 THEN
            RAISE EXCEPTION 'Para activar Caja Varios debés indicar un monto diario mayor a $0';
        END IF;

        INSERT INTO cajas (negocio_id, codigo, nombre, descripcion, saldo_actual)
        VALUES (p_negocio_id, 'VARIOS', 'Varios', 'Fondo de emergencia', 0)
        ON CONFLICT (negocio_id, codigo) DO NOTHING;
    END IF;

    -- ── Flags de configuración ──
    INSERT INTO configuraciones (negocio_id, clave, valor) VALUES
    (p_negocio_id, 'recargas_celular_habilitada', p_celular::TEXT),
    (p_negocio_id, 'recargas_bus_habilitada',     p_bus::TEXT)
    ON CONFLICT (negocio_id, clave) DO UPDATE SET valor = EXCLUDED.valor;

    IF p_varios THEN
        INSERT INTO configuraciones (negocio_id, clave, valor)
        VALUES (p_negocio_id, 'caja_varios_activa', 'true')
        ON CONFLICT (negocio_id, clave) DO UPDATE SET valor = 'true';

        INSERT INTO configuraciones (negocio_id, clave, valor)
        VALUES (p_negocio_id, 'caja_varios_transferencia_dia', p_varios_monto::TEXT)
        ON CONFLICT (negocio_id, clave) DO UPDATE SET valor = EXCLUDED.valor;
    END IF;

    RETURN json_build_object('success', TRUE);

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al configurar módulos: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_configurar_modulos_admin(UUID, BOOLEAN, BOOLEAN, BOOLEAN, DECIMAL) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_configurar_modulos_admin(UUID, BOOLEAN, BOOLEAN, BOOLEAN, DECIMAL) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_configurar_modulos_admin(UUID, BOOLEAN, BOOLEAN, BOOLEAN, DECIMAL) TO authenticated;

NOTIFY pgrst, 'reload schema';
