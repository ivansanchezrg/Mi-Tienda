-- ==========================================
-- fn_registrar_pago_fiado (v2.0)
-- ==========================================
-- Registra un pago (total o parcial) contra una venta fiada.
--
-- CAMBIOS v2.0 (schema v11 — multi-tenant UUID):
--   - v_empleado_id, v_caja_id, v_categoria_id: INTEGER → UUID
--   - columna 'usuario' → 'email' (renombrada en schema v11)
--   - Agrega v_negocio_id := public.get_negocio_id() (SECURITY DEFINER bypasea RLS)
--   - Filtra cajas y categorias_operaciones por negocio_id
--   - INSERT cuentas_cobrar incluye negocio_id (NOT NULL en schema)
--   - INSERT operaciones_cajas incluye negocio_id (NOT NULL en schema)
--   - v_tipo_referencia_id permanece INTEGER (tipos_referencia usa SERIAL)
--
-- Flujo:
--   1. Valida que la venta sea FIADO y tenga saldo pendiente
--   2. Inserta registro en cuentas_cobrar
--   3. Actualiza estado_pago de la venta (PAGADO_PARCIAL o PAGADO)
--   4. Si metodo_pago = EFECTIVO → ingresa a CAJA_CHICA
--
-- Retorna JSON: { success: true }
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_registrar_pago_fiado(
    p_venta_id       UUID,
    p_monto          DECIMAL(12,2),
    p_metodo_pago    VARCHAR(20),
    p_observaciones  TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id         UUID;
    v_venta_total        DECIMAL(12,2);
    v_venta_metodo_pago  VARCHAR(20);
    v_venta_estado_pago  VARCHAR(20);
    v_total_pagado       DECIMAL(12,2);
    v_saldo_pendiente    DECIMAL(12,2);
    v_nuevo_estado       VARCHAR(20);
    v_empleado_id        UUID;
    v_caja_id            UUID;
    v_tipo_referencia_id INTEGER;  -- tipos_referencia usa SERIAL → INTEGER
    v_saldo_caja         DECIMAL(12,2);
BEGIN
    PERFORM public.fn_assert_no_superadmin();

    -- 0. Negocio del JWT (SECURITY DEFINER bypasea RLS — filtro manual obligatorio)
    v_negocio_id := public.get_negocio_id();

    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;

    -- 1. Obtener empleado autenticado
    v_empleado_id := (SELECT id FROM usuarios WHERE email = (auth.jwt() ->> 'email'));

    IF v_empleado_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    -- 2. Validar venta — PERFORM para lock + := para leer campos
    PERFORM id FROM ventas WHERE id = p_venta_id AND negocio_id = v_negocio_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Venta no encontrada';
    END IF;

    v_venta_total       := (SELECT total        FROM ventas WHERE id = p_venta_id);
    v_venta_metodo_pago := (SELECT metodo_pago  FROM ventas WHERE id = p_venta_id);
    v_venta_estado_pago := (SELECT estado_pago  FROM ventas WHERE id = p_venta_id);

    IF v_venta_metodo_pago != 'FIADO' THEN
        RAISE EXCEPTION 'La venta no es de tipo FIADO';
    END IF;

    IF v_venta_estado_pago = 'PAGADO' THEN
        RAISE EXCEPTION 'Esta venta ya esta completamente pagada';
    END IF;

    -- 3. Calcular saldo pendiente
    v_total_pagado := (
        SELECT COALESCE(SUM(monto), 0)
        FROM cuentas_cobrar
        WHERE venta_id = p_venta_id
          AND negocio_id = v_negocio_id
    );

    v_saldo_pendiente := v_venta_total - v_total_pagado;

    IF p_monto <= 0 THEN
        RAISE EXCEPTION 'El monto debe ser mayor a 0';
    END IF;

    IF p_monto > v_saldo_pendiente THEN
        RAISE EXCEPTION 'El monto ($%) supera el saldo pendiente ($%)', p_monto, v_saldo_pendiente;
    END IF;

    -- 4. Insertar pago
    INSERT INTO cuentas_cobrar (negocio_id, venta_id, empleado_id, monto, metodo_pago, observaciones)
    VALUES (v_negocio_id, p_venta_id, v_empleado_id, p_monto, p_metodo_pago, p_observaciones);

    -- 5. Actualizar estado_pago de la venta
    v_nuevo_estado := CASE
        WHEN (v_total_pagado + p_monto) >= v_venta_total THEN 'PAGADO'
        ELSE 'PAGADO_PARCIAL'
    END;

    UPDATE ventas
    SET estado_pago = v_nuevo_estado
    WHERE id = p_venta_id;

    -- 6. Si es EFECTIVO → ingresar a CAJA_CHICA
    IF p_metodo_pago = 'EFECTIVO' THEN
        v_caja_id            := (SELECT id FROM cajas            WHERE codigo = 'CAJA_CHICA' AND negocio_id = v_negocio_id);
        v_tipo_referencia_id := (SELECT id FROM tipos_referencia WHERE tabla = 'ventas' LIMIT 1);

        IF v_caja_id IS NOT NULL THEN
            v_saldo_caja := (SELECT saldo_actual FROM cajas WHERE id = v_caja_id);

            INSERT INTO operaciones_cajas (
                negocio_id,
                caja_id, empleado_id, tipo_operacion, monto,
                saldo_anterior, saldo_actual,
                -- VENTA-POS: UUID fijo de categorias_sistema (antes IN-001 en categorias_operaciones)
                categoria_sistema_id, tipo_referencia_id, referencia_id,
                descripcion
            ) VALUES (
                v_negocio_id,
                v_caja_id, v_empleado_id, 'INGRESO', p_monto,
                v_saldo_caja, v_saldo_caja + p_monto,
                'a1000001-0000-0000-0000-000000000013', v_tipo_referencia_id, p_venta_id,
                'Pago fiado - ' || COALESCE(p_observaciones, 'Sin observaciones')
            );

            UPDATE cajas
            SET saldo_actual = saldo_actual + p_monto
            WHERE id = v_caja_id;
        END IF;
    END IF;

    RETURN json_build_object('success', true);
END;
$$;

-- ==========================================
-- PERMISOS
-- ==========================================
REVOKE EXECUTE ON FUNCTION public.fn_registrar_pago_fiado(UUID, DECIMAL, VARCHAR, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_registrar_pago_fiado(UUID, DECIMAL, VARCHAR, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_registrar_pago_fiado IS
    'v2.0 — Multi-tenant UUID. Registra pago (total o parcial) de venta FIADO. '
    'Inserta en cuentas_cobrar, actualiza estado_pago de la venta y, si es EFECTIVO, '
    'acredita CAJA_CHICA con operaciones_cajas. Filtra por negocio_id del JWT.';
