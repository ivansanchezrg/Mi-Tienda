-- ==========================================
-- fn_registrar_pago_fiado
-- ==========================================
-- Registra un pago (total o parcial) contra una venta fiada.
--
-- Flujo:
--   1. Valida que la venta sea FIADO y tenga saldo pendiente
--   2. Inserta registro en cuentas_cobrar
--   3. Actualiza estado_pago de la venta (PAGADO_PARCIAL o PAGADO)
--   4. Si metodo_pago = EFECTIVO → ingresa a CAJA_CHICA
--
-- Retorna JSON: { success: true }
-- ==========================================

CREATE OR REPLACE FUNCTION fn_registrar_pago_fiado(
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
    v_venta              RECORD;
    v_total_pagado       DECIMAL(12,2);
    v_saldo_pendiente    DECIMAL(12,2);
    v_nuevo_estado       VARCHAR(20);
    v_empleado_id        INTEGER;
    v_caja_id            INTEGER;
    v_categoria_id       INTEGER;
    v_tipo_referencia_id INTEGER;
    v_saldo_caja         DECIMAL(12,2);
BEGIN
    -- 0. Obtener empleado autenticado
    SELECT id INTO v_empleado_id
    FROM usuarios
    WHERE usuario = auth.jwt() ->> 'email';

    IF v_empleado_id IS NULL THEN
        RAISE EXCEPTION 'Usuario no autenticado';
    END IF;

    -- 1. Validar venta
    SELECT id, total, metodo_pago, estado, estado_pago
    INTO v_venta
    FROM ventas
    WHERE id = p_venta_id
    FOR UPDATE;  -- lock para evitar pagos concurrentes

    IF v_venta IS NULL THEN
        RAISE EXCEPTION 'Venta no encontrada';
    END IF;

    IF v_venta.metodo_pago != 'FIADO' THEN
        RAISE EXCEPTION 'La venta no es de tipo FIADO';
    END IF;

    IF v_venta.estado_pago = 'PAGADO' THEN
        RAISE EXCEPTION 'Esta venta ya esta completamente pagada';
    END IF;

    -- 2. Calcular saldo pendiente
    SELECT COALESCE(SUM(monto), 0) INTO v_total_pagado
    FROM cuentas_cobrar
    WHERE venta_id = p_venta_id;

    v_saldo_pendiente := v_venta.total - v_total_pagado;

    IF p_monto > v_saldo_pendiente THEN
        RAISE EXCEPTION 'El monto ($%) supera el saldo pendiente ($%)', p_monto, v_saldo_pendiente;
    END IF;

    IF p_monto <= 0 THEN
        RAISE EXCEPTION 'El monto debe ser mayor a 0';
    END IF;

    -- 3. Insertar pago
    INSERT INTO cuentas_cobrar (venta_id, empleado_id, monto, metodo_pago, observaciones)
    VALUES (p_venta_id, v_empleado_id, p_monto, p_metodo_pago, p_observaciones);

    -- 4. Actualizar estado_pago de la venta
    v_nuevo_estado := CASE
        WHEN (v_total_pagado + p_monto) >= v_venta.total THEN 'PAGADO'
        ELSE 'PAGADO_PARCIAL'
    END;

    UPDATE ventas
    SET estado_pago = v_nuevo_estado
    WHERE id = p_venta_id;

    -- 5. Si es EFECTIVO → ingresar a CAJA_CHICA
    IF p_metodo_pago = 'EFECTIVO' THEN
        SELECT id INTO v_caja_id FROM cajas WHERE codigo = 'CAJA_CHICA';
        SELECT id INTO v_categoria_id
        FROM categorias_operaciones
        WHERE tipo = 'INGRESO' AND nombre ILIKE '%Ventas%' LIMIT 1;
        SELECT id INTO v_tipo_referencia_id
        FROM tipos_referencia WHERE tabla = 'ventas' LIMIT 1;

        IF v_caja_id IS NOT NULL AND v_categoria_id IS NOT NULL AND v_tipo_referencia_id IS NOT NULL THEN
            SELECT saldo_actual INTO v_saldo_caja FROM cajas WHERE id = v_caja_id;

            INSERT INTO operaciones_cajas (
                caja_id, empleado_id, tipo_operacion, monto,
                saldo_anterior, saldo_actual,
                categoria_id, tipo_referencia_id, referencia_id,
                descripcion
            ) VALUES (
                v_caja_id, v_empleado_id, 'INGRESO', p_monto,
                v_saldo_caja, v_saldo_caja + p_monto,
                v_categoria_id, v_tipo_referencia_id, p_venta_id,
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

-- Permisos
REVOKE EXECUTE ON FUNCTION fn_registrar_pago_fiado(UUID, DECIMAL, VARCHAR, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION fn_registrar_pago_fiado(UUID, DECIMAL, VARCHAR, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
