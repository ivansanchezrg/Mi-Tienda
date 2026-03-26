-- ==========================================
-- FUNCIÓN: anular_venta (v1.1)
-- ==========================================
-- Anula una venta completada revirtiendo TODOS sus efectos:
--   1. Repone stock de cada producto vendido
--   2. Registra movimiento ANULACION_VENTA en kardex_inventario
--   3. Revierte saldo de caja CAJA (solo si fue EFECTIVO)
--   4. Elimina registros de cuentas_cobrar (solo si fue FIADO)
--   5. Marca la venta como estado='ANULADA'
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

CREATE OR REPLACE FUNCTION public.anular_venta(
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
    v_venta              RECORD;
    v_detalle            RECORD;
    v_stock_actual       DECIMAL(12,2);
    v_caja_id            INTEGER;
    v_saldo_actual_caja  DECIMAL(12,2);
    v_categoria_id       INTEGER;
    v_tipo_referencia_id INTEGER;
BEGIN

    -- ══════════════════════════════════════
    -- 0. Validaciones
    -- ══════════════════════════════════════
    IF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN
        RAISE EXCEPTION 'El motivo de anulación es obligatorio';
    END IF;

    SELECT id, estado, metodo_pago, total, numero_comprobante, estado_pago
    INTO   v_venta
    FROM   ventas
    WHERE  id = p_venta_id;

    IF v_venta.id IS NULL THEN
        RAISE EXCEPTION 'Venta no encontrada: %', p_venta_id;
    END IF;

    IF v_venta.estado = 'ANULADA' THEN
        RAISE EXCEPTION 'La venta #% ya fue anulada', v_venta.numero_comprobante;
    END IF;

    -- Bloquear si es FIADO con abonos parciales.
    -- Si el cliente ya pagó algo, hay una transacción de dinero real que no se puede
    -- revertir automáticamente. Debe resolverse manualmente fuera del sistema.
    IF v_venta.metodo_pago = 'FIADO' THEN
        IF EXISTS (SELECT 1 FROM cuentas_cobrar WHERE venta_id = p_venta_id LIMIT 1) THEN
            RAISE EXCEPTION 'No se puede anular la venta #%: ya tiene abonos registrados. Resuelve los pagos parciales primero.', v_venta.numero_comprobante;
        END IF;
    END IF;

    -- ══════════════════════════════════════
    -- 1. Reponer stock + registrar kardex
    -- ══════════════════════════════════════
    FOR v_detalle IN
        SELECT producto_id, cantidad
        FROM   ventas_detalles
        WHERE  venta_id = p_venta_id
    LOOP
        SELECT stock_actual INTO v_stock_actual
        FROM   productos
        WHERE  id = v_detalle.producto_id;

        UPDATE productos
        SET    stock_actual = stock_actual + v_detalle.cantidad
        WHERE  id = v_detalle.producto_id;

        INSERT INTO kardex_inventario (
            producto_id, tipo_movimiento, cantidad,
            stock_anterior, stock_nuevo,
            referencia_id, observaciones
        ) VALUES (
            v_detalle.producto_id,
            'ANULACION_VENTA',
            v_detalle.cantidad,
            v_stock_actual,
            v_stock_actual + v_detalle.cantidad,
            p_venta_id,
            'Anulación Venta POS #' || v_venta.numero_comprobante || ': ' || TRIM(p_motivo)
        );
    END LOOP;

    -- ══════════════════════════════════════
    -- 2. Revertir saldo de caja (solo EFECTIVO)
    -- ══════════════════════════════════════
    IF v_venta.metodo_pago = 'EFECTIVO' THEN
        SELECT id, saldo_actual
        INTO   v_caja_id, v_saldo_actual_caja
        FROM   cajas
        WHERE  codigo = 'CAJA';

        -- Categoría EGRESO genérica para anulaciones
        SELECT id INTO v_categoria_id
        FROM   categorias_operaciones
        WHERE  tipo = 'EGRESO' AND nombre ILIKE '%Otros Gastos%'
        LIMIT  1;

        SELECT id INTO v_tipo_referencia_id
        FROM   tipos_referencia
        WHERE  tabla = 'ventas'
        LIMIT  1;

        IF v_caja_id IS NOT NULL AND v_categoria_id IS NOT NULL THEN
            INSERT INTO operaciones_cajas (
                caja_id, empleado_id, tipo_operacion, monto,
                saldo_anterior, saldo_actual,
                categoria_id, tipo_referencia_id, referencia_id, descripcion
            ) VALUES (
                v_caja_id,
                p_empleado_id,
                'EGRESO',
                v_venta.total,
                v_saldo_actual_caja,
                v_saldo_actual_caja - v_venta.total,
                v_categoria_id,
                v_tipo_referencia_id,
                p_venta_id,
                'Anulación Venta POS #' || v_venta.numero_comprobante
            );

            UPDATE cajas
            SET    saldo_actual = saldo_actual - v_venta.total
            WHERE  id = v_caja_id;
        END IF;
    END IF;

    -- ══════════════════════════════════════
    -- 3. Anular cuenta por cobrar (solo FIADO)
    -- ══════════════════════════════════════
    IF v_venta.metodo_pago = 'FIADO' THEN
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
        'numero_comprobante', v_venta.numero_comprobante,
        'monto_revertido',    v_venta.total
    );

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al anular venta: %', SQLERRM;
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.anular_venta(UUID, INTEGER, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.anular_venta(UUID, INTEGER, TEXT) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.anular_venta IS
    'v1.1 — Anula una venta completada revirtiendo stock (kardex ANULACION_VENTA), '
    'saldo de caja (EGRESO si fue EFECTIVO), y cuentas por cobrar (DELETE si fue FIADO sin abonos). '
    'Bloquea si es FIADO con abonos parciales — esa transacción ya es real y no se puede revertir automáticamente. '
    'Ambos roles (ADMIN/EMPLEADO) pueden anular. Motivo obligatorio.';
