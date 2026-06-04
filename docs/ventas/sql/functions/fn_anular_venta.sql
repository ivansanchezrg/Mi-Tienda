-- ==========================================
-- FUNCIÓN: fn_anular_venta (v2.0)
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
-- CAMBIOS v2.1 (migración categorias_sistema):
--   - Categoría ANULACION-VENTA migrada a categorias_sistema (UUID fijo).
--   - Eliminado v_categoria_id y lookup a categorias_operaciones.
--   - INSERT usa categoria_sistema_id en lugar de categoria_id.
--
-- CAMBIOS v2.0:
--   - p_empleado_id: INTEGER → UUID (schema v11 migró PKs a UUID)
--   - v_caja_id, v_tipo_referencia_id: INTEGER → UUID
--   - Multi-tenant: get_negocio_id() + filtro negocio_id en cajas
--   - DROP/GRANT usan firma UUID
--
-- HEREDA DE v1.3:
--   - Fix: revierte EFECTIVO de la caja correcta según estado del turno
--   - Fix: usa factor_conversion al reponer stock (JOIN a producto_presentaciones)
--   - Bloquea si es FIADO con abonos parciales
--
-- Si CUALQUIER paso falla, PostgreSQL hace rollback automático completo.
--
-- Quién puede anular: ADMIN y EMPLEADO (sin restricción de rol).
-- La validación de rol se hace en el frontend si se necesita en el futuro.
--
-- Llamada desde: VentasService.anularVenta()
-- Parámetros:
--   p_venta_id    — UUID de la venta a anular
--   p_empleado_id — UUID del empleado que anula (auditoría)
--   p_motivo      — Razón de la anulación (obligatorio)
-- ==========================================

-- DROP versión anterior con firma INTEGER
DROP FUNCTION IF EXISTS public.fn_anular_venta(UUID, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.fn_anular_venta(
    p_venta_id    UUID,
    p_empleado_id UUID,
    p_motivo      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id         UUID;
    v_detalle            RECORD;
    v_venta_rec          RECORD;
    -- campos de ventas
    v_venta_id_check     UUID;
    v_venta_estado       TEXT;
    v_venta_metodo_pago  TEXT;
    v_venta_total        DECIMAL(12,2);
    v_venta_numero       INTEGER;
    v_venta_turno_id     UUID;
    v_venta_tipo_comp    TEXT;
    v_descripcion_op     TEXT;
    -- resto de variables
    v_stock_actual       DECIMAL(12,2);
    v_cantidad_real      DECIMAL(12,2);
    v_caja_id            UUID;
    v_saldo_actual_caja  DECIMAL(12,2);
    -- UUID fijo de categorias_sistema para ANULACION-VENTA
    v_cat_sistema_id     CONSTANT UUID := 'a1000001-0000-0000-0000-000000000010';
    v_tipo_referencia_id INTEGER;
    v_turno_abierto      BOOLEAN;
BEGIN
    -- ══════════════════════════════════════
    -- 0. Tenant + Validaciones
    -- ══════════════════════════════════════

    PERFORM public.fn_assert_no_superadmin();

    v_negocio_id := public.get_negocio_id();
    IF v_negocio_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'No hay negocio activo en el JWT');
    END IF;

    IF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN
        RAISE EXCEPTION 'El motivo de anulación es obligatorio';
    END IF;

    -- Lock + lectura atómica de la venta (FOR..LOOP single-row con FOR UPDATE).
    -- Reemplaza 7 subqueries idénticas y previene race conditions.
    FOR v_venta_rec IN
        SELECT id, estado, metodo_pago, total, numero_comprobante, turno_id, tipo_comprobante::TEXT AS tipo_comp
        FROM ventas
        WHERE id = p_venta_id AND negocio_id = v_negocio_id
        FOR UPDATE
    LOOP
        v_venta_id_check    := v_venta_rec.id;
        v_venta_estado      := v_venta_rec.estado;
        v_venta_metodo_pago := v_venta_rec.metodo_pago;
        v_venta_total       := v_venta_rec.total;
        v_venta_numero      := v_venta_rec.numero_comprobante;
        v_venta_turno_id    := v_venta_rec.turno_id;
        v_venta_tipo_comp   := v_venta_rec.tipo_comp;
        EXIT;
    END LOOP;

    -- Descripción: "Ticket #3 — motivo del usuario"
    v_descripcion_op := CASE v_venta_tipo_comp
        WHEN 'TICKET'     THEN 'Ticket #'         || v_venta_numero
        WHEN 'FACTURA'    THEN 'Factura #'         || v_venta_numero
        WHEN 'NOTA_VENTA' THEN 'Nota de Venta #'   || v_venta_numero
        ELSE v_venta_tipo_comp || ' #'             || v_venta_numero
    END || ' — ' || TRIM(p_motivo);

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
            negocio_id, producto_id, tipo_movimiento, cantidad,
            stock_anterior, stock_nuevo,
            referencia_id, presentacion_id, observaciones
        ) VALUES (
            v_negocio_id,
            v_detalle.producto_id,
            'ANULACION_VENTA',
            v_cantidad_real,
            v_stock_actual,
            v_stock_actual + v_cantidad_real,
            p_venta_id,
            v_detalle.presentacion_id,
            v_descripcion_op
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
            v_caja_id           := (SELECT id FROM cajas WHERE codigo = 'CAJA_CHICA' AND negocio_id = v_negocio_id);
            v_saldo_actual_caja := (SELECT saldo_actual FROM cajas WHERE codigo = 'CAJA_CHICA' AND negocio_id = v_negocio_id);
        ELSE
            v_caja_id           := (SELECT id FROM cajas WHERE codigo = 'CAJA' AND negocio_id = v_negocio_id);
            v_saldo_actual_caja := (SELECT saldo_actual FROM cajas WHERE codigo = 'CAJA' AND negocio_id = v_negocio_id);
        END IF;

        -- v_cat_sistema_id: UUID fijo de categorias_sistema (ANULACION-VENTA), declarado en DECLARE.
        v_tipo_referencia_id := (SELECT id FROM tipos_referencia WHERE tabla = 'ventas' LIMIT 1);

        IF v_caja_id IS NOT NULL THEN
            INSERT INTO operaciones_cajas (
                caja_id, empleado_id, tipo_operacion, monto,
                saldo_anterior, saldo_actual,
                categoria_sistema_id, tipo_referencia_id, referencia_id, descripcion,
                negocio_id
            ) VALUES (
                v_caja_id,
                p_empleado_id,
                'EGRESO',
                v_venta_total,
                v_saldo_actual_caja,
                v_saldo_actual_caja - v_venta_total,
                v_cat_sistema_id,
                v_tipo_referencia_id,
                p_venta_id,
                v_descripcion_op,
                v_negocio_id
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
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_anular_venta(UUID, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_anular_venta(UUID, UUID, TEXT) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_anular_venta IS
    'v2.1 — Categoría ANULACION-VENTA migrada a categorias_sistema (UUID fijo a1000001-...-000000000010). '
    'v2.0 — UUID + multi-tenant. p_empleado_id y variables de ID cambiados de INTEGER a UUID (schema v11). '
    'v1.3 — Fix: revierte EFECTIVO de la caja correcta según estado del turno. '
    'Turno abierto → CAJA_CHICA (donde el trigger original ingresó el dinero). '
    'Turno cerrado → CAJA (bóveda, donde el cierre depositó el dinero). '
    'v1.2 — Fix: usa factor_conversion al reponer stock (JOIN a producto_presentaciones). '
    'v1.1 — Anula venta: stock (kardex ANULACION_VENTA), saldo caja (EGRESO si EFECTIVO), '
    'cuentas_cobrar (DELETE si FIADO sin abonos). Bloquea si FIADO con abonos. Motivo obligatorio.';
