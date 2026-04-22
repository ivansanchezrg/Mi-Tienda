-- ==========================================
-- FUNCIÓN: fn_anular_venta (v1.3)
-- ==========================================
-- Anula una venta completada revirtiendo TODOS sus efectos:
--   1. Repone stock de cada producto vendido (con factor_conversion si fue via presentacion)
--   2. Registra movimiento ANULACION_VENTA en kardex_inventario
--   3. Revierte saldo de caja (solo si fue EFECTIVO):
--      - Turno aún abierto → revierte de CAJA_CHICA (donde el trigger original ingresó)
--      - Turno ya cerrado  → revierte de CAJA (bóveda, donde el cierre depositó el dinero)
--   4. Elimina registros de cuentas_cobrar (solo si fue FIADO)
--   5. Marca la venta como estado='ANULADA'
--
-- v1.3 — Fix: revierte EFECTIVO de la caja correcta según estado del turno.
--   Antes siempre revertía de CAJA (bóveda), pero el trigger fn_actualizar_saldo_caja_venta
--   ingresa a CAJA_CHICA. Si el turno sigue abierto, el dinero aún está en CAJA_CHICA.
--
-- v1.2 — Fix: usa factor_conversion de la presentacion al reponer stock.
--   Antes reponia v_detalle.cantidad (raw) en vez de cantidad * factor.
--   Si vendiste 2 cajetillas x20, el trigger desconto 40 pero la anulacion reponia 2.
--
-- Si CUALQUIER paso falla, PostgreSQL hace rollback automático completo.
--
-- Quién puede anular: ADMIN y EMPLEADO (sin restricción de rol).
-- La validación de rol se hace en el frontend si se necesita en el futuro.
--
-- Llamada desde: VentasService.anularVenta()
-- Parámetros:
--   p_venta_id    — UUID de la venta a anular
--   p_empleado_id — ID del empleado que anula (auditoría)
--   p_motivo      — Razón de la anulación (obligatorio)
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_anular_venta(
    p_venta_id    UUID,
    p_empleado_id INTEGER,
    p_motivo      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_detalle            RECORD;
    -- campos de ventas
    v_venta_id_check     UUID;
    v_venta_estado       TEXT;
    v_venta_metodo_pago  TEXT;
    v_venta_total        DECIMAL(12,2);
    v_venta_numero       INTEGER;
    v_venta_turno_id     UUID;
    -- resto de variables
    v_stock_actual       DECIMAL(12,2);
    v_cantidad_real      DECIMAL(12,2);
    v_caja_id            INTEGER;
    v_saldo_actual_caja  DECIMAL(12,2);
    v_categoria_id       INTEGER;
    v_tipo_referencia_id INTEGER;
    v_turno_abierto      BOOLEAN;
BEGIN

    -- ══════════════════════════════════════
    -- 0. Validaciones
    -- ══════════════════════════════════════
    IF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN
        RAISE EXCEPTION 'El motivo de anulación es obligatorio';
    END IF;

    v_venta_id_check    := (SELECT id               FROM ventas WHERE id = p_venta_id);
    v_venta_estado      := (SELECT estado            FROM ventas WHERE id = p_venta_id);
    v_venta_metodo_pago := (SELECT metodo_pago       FROM ventas WHERE id = p_venta_id);
    v_venta_total       := (SELECT total             FROM ventas WHERE id = p_venta_id);
    v_venta_numero      := (SELECT numero_comprobante FROM ventas WHERE id = p_venta_id);
    v_venta_turno_id    := (SELECT turno_id          FROM ventas WHERE id = p_venta_id);

    IF v_venta_id_check IS NULL THEN
        RAISE EXCEPTION 'Venta no encontrada: %', p_venta_id;
    END IF;

    IF v_venta_estado = 'ANULADA' THEN
        RAISE EXCEPTION 'La venta #% ya fue anulada', v_venta_numero;
    END IF;

    -- Bloquear si es FIADO con abonos parciales.
    -- Si el cliente ya pagó algo, hay una transacción de dinero real que no se puede
    -- revertir automáticamente. Debe resolverse manualmente fuera del sistema.
    IF v_venta_metodo_pago = 'FIADO' THEN
        IF EXISTS (SELECT 1 FROM cuentas_cobrar WHERE venta_id = p_venta_id LIMIT 1) THEN
            RAISE EXCEPTION 'No se puede anular la venta #%: ya tiene abonos registrados. Resuelve los pagos parciales primero.', v_venta_numero;
        END IF;
    END IF;

    -- ══════════════════════════════════════
    -- 1. Reponer stock + registrar kardex
    --    JOIN a producto_presentaciones para obtener factor_conversion.
    --    Si presentacion_id es NULL (venta directa), factor = 1.
    --    cantidad_real = cantidad_vendida * factor (misma logica que el trigger de venta).
    -- ══════════════════════════════════════
    FOR v_detalle IN
        SELECT vd.producto_id,
               vd.cantidad,
               vd.presentacion_id,
               COALESCE(pp.factor_conversion, 1) AS factor
        FROM   ventas_detalles vd
        LEFT JOIN producto_presentaciones pp ON pp.id = vd.presentacion_id
        WHERE  vd.venta_id = p_venta_id
    LOOP
        v_cantidad_real := v_detalle.cantidad * v_detalle.factor;

        v_stock_actual := (SELECT stock_actual FROM productos WHERE id = v_detalle.producto_id);

        UPDATE productos
        SET    stock_actual = stock_actual + v_cantidad_real
        WHERE  id = v_detalle.producto_id;

        INSERT INTO kardex_inventario (
            producto_id, tipo_movimiento, cantidad,
            stock_anterior, stock_nuevo,
            referencia_id, presentacion_id, observaciones
        ) VALUES (
            v_detalle.producto_id,
            'ANULACION_VENTA',
            v_cantidad_real,
            v_stock_actual,
            v_stock_actual + v_cantidad_real,
            p_venta_id,
            v_detalle.presentacion_id,
            'Anulación Venta POS #' || v_venta_numero || ': ' || TRIM(p_motivo)
        );
    END LOOP;

    -- ══════════════════════════════════════
    -- 2. Revertir saldo de caja (solo EFECTIVO)
    --
    -- El trigger fn_actualizar_saldo_caja_venta ingresa ventas EFECTIVO a CAJA_CHICA.
    -- Al cierre, fn_ejecutar_cierre_diario mueve ese dinero a CAJA (bóveda).
    -- Por eso: si el turno de la venta aún está abierto → revertir de CAJA_CHICA.
    --          si el turno ya cerró                     → revertir de CAJA.
    -- ══════════════════════════════════════
    IF v_venta_metodo_pago = 'EFECTIVO' THEN

        -- ¿El turno de la venta sigue abierto?
        v_turno_abierto := (SELECT hora_fecha_cierre IS NULL FROM turnos_caja WHERE id = v_venta_turno_id);

        IF v_turno_abierto THEN
            v_caja_id           := (SELECT id FROM cajas WHERE codigo = 'CAJA_CHICA');
            v_saldo_actual_caja := (SELECT saldo_actual FROM cajas WHERE codigo = 'CAJA_CHICA');
        ELSE
            v_caja_id           := (SELECT id FROM cajas WHERE codigo = 'CAJA');
            v_saldo_actual_caja := (SELECT saldo_actual FROM cajas WHERE codigo = 'CAJA');
        END IF;

        -- Categoría EGRESO genérica para anulaciones
        v_categoria_id := (
            SELECT id FROM categorias_operaciones
            WHERE tipo = 'EGRESO' AND nombre ILIKE '%Otros Gastos%'
            LIMIT 1
        );

        v_tipo_referencia_id := (SELECT id FROM tipos_referencia WHERE tabla = 'ventas' LIMIT 1);

        IF v_caja_id IS NOT NULL AND v_categoria_id IS NOT NULL THEN
            INSERT INTO operaciones_cajas (
                caja_id, empleado_id, tipo_operacion, monto,
                saldo_anterior, saldo_actual,
                categoria_id, tipo_referencia_id, referencia_id, descripcion
            ) VALUES (
                v_caja_id,
                p_empleado_id,
                'EGRESO',
                v_venta_total,
                v_saldo_actual_caja,
                v_saldo_actual_caja - v_venta_total,
                v_categoria_id,
                v_tipo_referencia_id,
                p_venta_id,
                'Anulación Venta POS #' || v_venta_numero
            );

            UPDATE cajas
            SET    saldo_actual = saldo_actual - v_venta_total
            WHERE  id = v_caja_id;
        END IF;
    END IF;

    -- ══════════════════════════════════════
    -- 3. Anular cuenta por cobrar (solo FIADO)
    -- ══════════════════════════════════════
    IF v_venta_metodo_pago = 'FIADO' THEN
        DELETE FROM cuentas_cobrar
        WHERE  venta_id = p_venta_id;
    END IF;

    -- ══════════════════════════════════════
    -- 4. Marcar la venta como ANULADA
    -- ══════════════════════════════════════
    UPDATE ventas
    SET    estado      = 'ANULADA',
           estado_pago = 'NO_APLICA',
           observaciones = CASE
               WHEN observaciones IS NOT NULL AND observaciones <> ''
               THEN observaciones || ' | ANULADA: ' || TRIM(p_motivo)
               ELSE 'ANULADA: ' || TRIM(p_motivo)
           END
    WHERE  id = p_venta_id;

    -- ══════════════════════════════════════
    -- 5. Resultado
    -- ══════════════════════════════════════
    RETURN json_build_object(
        'success',            true,
        'venta_id',           p_venta_id,
        'numero_comprobante', v_venta_numero,
        'monto_revertido',    v_venta_total
    );

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al anular venta: %', SQLERRM;
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_anular_venta(UUID, INTEGER, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_anular_venta(UUID, INTEGER, TEXT) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_anular_venta IS
    'v1.3 — Fix: revierte EFECTIVO de la caja correcta según estado del turno. '
    'Turno abierto → CAJA_CHICA (donde el trigger original ingresó el dinero). '
    'Turno cerrado → CAJA (bóveda, donde el cierre depositó el dinero). '
    'v1.2 — Fix: usa factor_conversion al reponer stock (JOIN a producto_presentaciones). '
    'Antes reponia cantidad raw sin multiplicar por el factor de la presentacion. '
    'v1.1 — Anula una venta completada revirtiendo stock (kardex ANULACION_VENTA), '
    'saldo de caja (EGRESO si fue EFECTIVO), y cuentas por cobrar (DELETE si fue FIADO sin abonos). '
    'Bloquea si es FIADO con abonos parciales. Ambos roles pueden anular. Motivo obligatorio.';
