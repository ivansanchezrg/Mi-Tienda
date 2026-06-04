-- =============================================================================
-- fn_configurar_modulos_admin — Activa o desactiva módulos para un negocio
-- específico, operado remotamente por el superadmin desde /admin.
-- =============================================================================
-- Diferencia con fn_configurar_modulos: acepta p_negocio_id explícito en lugar
-- de leerlo del JWT. Permite al superadmin configurar cualquier negocio sin
-- necesidad de entrar a él (cambiar el JWT).
--
-- Parámetros:
--   p_negocio_id        UUID           — negocio a configurar
--   p_celular           BOOLEAN        — true = activar, false = desactivar
--   p_bus               BOOLEAN        — true = activar, false = desactivar
--   p_varios            BOOLEAN        — true = activar (irreversible), false = sin cambio
--   p_varios_monto      DECIMAL(12,2)  — monto diario a transferir a VARIOS al cierre (requerido si p_varios = true)
--   p_tipo_comprobante  TEXT           — 'TICKET' | 'NOTA_VENTA' | 'FACTURA' (según régimen SRI)
--
-- Retorna: JSON con { success }
-- =============================================================================

-- Eliminar firmas anteriores
DROP FUNCTION IF EXISTS public.fn_habilitar_recargas_admin(UUID, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.fn_configurar_modulos_admin(UUID, BOOLEAN, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.fn_configurar_modulos_admin(UUID, BOOLEAN, BOOLEAN, BOOLEAN, DECIMAL);

CREATE OR REPLACE FUNCTION public.fn_configurar_modulos_admin(
    p_negocio_id        UUID,
    p_celular           BOOLEAN,
    p_bus               BOOLEAN,
    p_varios            BOOLEAN          DEFAULT FALSE,
    p_varios_monto      DECIMAL(12,2)    DEFAULT 0,
    p_tipo_comprobante  TEXT             DEFAULT 'TICKET'
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

    IF p_tipo_comprobante NOT IN ('TICKET', 'NOTA_VENTA', 'FACTURA') THEN
        RAISE EXCEPTION 'Tipo de comprobante inválido. Valores permitidos: TICKET, NOTA_VENTA, FACTURA';
    END IF;

    -- ── Módulo CELULAR ──
    IF p_celular THEN
        INSERT INTO cajas (negocio_id, codigo, nombre, descripcion, saldo_actual, puede_tener_turno, icono, color)
        VALUES (p_negocio_id, 'CAJA_CELULAR', 'Celular', 'Efectivo recargas celular', 0, FALSE, 'phone-portrait-outline', '#3dc2ff')
        ON CONFLICT (negocio_id, codigo) DO NOTHING;

        -- Categoría de sistema PAGO-PROV-CEL ya existe en categorias_sistema (global).
        -- No se crea por negocio.
    END IF;

    -- ── Módulo BUS ──
    IF p_bus THEN
        INSERT INTO cajas (negocio_id, codigo, nombre, descripcion, saldo_actual, puede_tener_turno, icono, color)
        VALUES (p_negocio_id, 'CAJA_BUS', 'Bus', 'Efectivo recargas bus', 0, FALSE, 'bus-outline', '#ffc409')
        ON CONFLICT (negocio_id, codigo) DO NOTHING;

        -- Categoría de sistema COMPRA-BUS ya existe en categorias_sistema (global).
        -- No se crea por negocio.

        INSERT INTO configuraciones (negocio_id, clave, valor) VALUES
        (p_negocio_id, 'bus_alerta_saldo_bajo',      '10'),
        (p_negocio_id, 'bus_dias_antes_facturacion', '3')
        ON CONFLICT (negocio_id, clave) DO NOTHING;
    END IF;

    -- ── Módulo VARIOS (irreversible: solo se activa, nunca se desactiva) ──
    IF p_varios THEN
        IF p_varios_monto IS NULL OR p_varios_monto <= 0 THEN
            RAISE EXCEPTION 'Para activar Caja Varios debes indicar un monto diario mayor a $0';
        END IF;

        INSERT INTO cajas (negocio_id, codigo, nombre, descripcion, saldo_actual, puede_tener_turno, icono, color)
        VALUES (p_negocio_id, 'VARIOS', 'Varios', 'Fondo de emergencia', 0, FALSE, 'archive-outline', '#7044ff')
        ON CONFLICT (negocio_id, codigo) DO NOTHING;
    END IF;

    -- ── Flags de configuración ──
    INSERT INTO configuraciones (negocio_id, clave, valor) VALUES
    (p_negocio_id, 'recargas_celular_habilitada', p_celular::TEXT),
    (p_negocio_id, 'recargas_bus_habilitada',     p_bus::TEXT),
    (p_negocio_id, 'pos_tipo_comprobante',         p_tipo_comprobante)
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
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_configurar_modulos_admin(UUID, BOOLEAN, BOOLEAN, BOOLEAN, DECIMAL, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_configurar_modulos_admin(UUID, BOOLEAN, BOOLEAN, BOOLEAN, DECIMAL, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_configurar_modulos_admin(UUID, BOOLEAN, BOOLEAN, BOOLEAN, DECIMAL, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
