-- ==========================================
-- SEED: Ventas de prueba con fechas distribuidas
-- ==========================================
-- Propósito: probar fn_reporte_ventas_periodo con datos reales
--            en distintos períodos (hoy, semana, mes, todo).
--
-- ⚠️  IMPORTANTE:
--   - Inserta directamente en ventas + ventas_detalles (NO usa registrar_venta_pos)
--     para evitar que los triggers descuenten stock de los productos de prueba.
--   - Requiere que el schema ya esté ejecutado con los datos iniciales
--     (turno activo, productos de prueba, consumidor final).
--   - Ajustar v_turno_id y v_empleado_id si los valores difieren en tu BD.
--   - Ejecutar UNA SOLA VEZ. Volver a ejecutar crea duplicados.
-- ==========================================

DO $$
DECLARE
    -- ── Resolución de IDs reales ──────────────────────────────────────────────
    v_turno_id      UUID;
    v_empleado_id   INTEGER;
    v_cliente_id    UUID;
    v_prod_cola     UUID;
    v_prod_ruffles  UUID;
    v_prod_yogur    UUID;

    -- ── Variables de trabajo ──────────────────────────────────────────────────
    v_venta_id      UUID;
    v_hoy           DATE := (NOW() AT TIME ZONE 'America/Guayaquil')::DATE;

BEGIN
    -- Obtener IDs reales del schema
    v_empleado_id := (SELECT id FROM usuarios WHERE rol = 'ADMIN' LIMIT 1);
    v_cliente_id  := (SELECT id FROM clientes WHERE es_consumidor_final = TRUE LIMIT 1);
    v_prod_cola   := (SELECT id FROM productos WHERE codigo_barras = '786123456001');
    v_prod_ruffles := (SELECT id FROM productos WHERE codigo_barras = '786123456002');
    v_prod_yogur  := (SELECT id FROM productos WHERE codigo_barras = '786123456003');

    -- Usar turno activo o crear uno temporal para el seed
    v_turno_id := (SELECT id FROM turnos_caja WHERE hora_fecha_cierre IS NULL LIMIT 1);

    IF v_turno_id IS NULL THEN
        INSERT INTO turnos_caja (numero_turno, empleado_id, hora_fecha_apertura)
        VALUES (1, v_empleado_id, NOW())
        RETURNING id INTO v_turno_id;
    END IF;

    -- ══════════════════════════════════════════════════════════════════════════
    -- HOY — 4 ventas
    -- ══════════════════════════════════════════════════════════════════════════

    -- Venta 1: Coca-Cola x3 + Ruffles x2 — EFECTIVO
    INSERT INTO ventas (turno_id, cliente_id, empleado_id, fecha, subtotal, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago)
    VALUES (v_turno_id, v_cliente_id, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '9 hours', 4.75, 4.75, 'EFECTIVO', 'TICKET', 1001, 'COMPLETADA', 'NO_APLICA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES
    (v_venta_id, v_prod_cola,    3, 1.25, 3.75),
    (v_venta_id, v_prod_ruffles, 2, 0.50, 1.00);

    -- Venta 2: Yogur x2 — TRANSFERENCIA
    INSERT INTO ventas (turno_id, cliente_id, empleado_id, fecha, subtotal, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago)
    VALUES (v_turno_id, v_cliente_id, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '11 hours', 1.20, 1.20, 'TRANSFERENCIA', 'TICKET', 1002, 'COMPLETADA', 'NO_APLICA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES
    (v_venta_id, v_prod_yogur, 2, 0.60, 1.20);

    -- Venta 3: Coca-Cola x5 — EFECTIVO
    INSERT INTO ventas (turno_id, cliente_id, empleado_id, fecha, subtotal, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago)
    VALUES (v_turno_id, v_cliente_id, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '14 hours', 6.25, 6.25, 'EFECTIVO', 'TICKET', 1003, 'COMPLETADA', 'NO_APLICA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES
    (v_venta_id, v_prod_cola, 5, 1.25, 6.25);

    -- Venta 4: ANULADA (para verificar que no aparece en totales)
    INSERT INTO ventas (turno_id, cliente_id, empleado_id, fecha, subtotal, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago)
    VALUES (v_turno_id, v_cliente_id, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '15 hours', 2.50, 2.50, 'EFECTIVO', 'TICKET', 1004, 'ANULADA', 'NO_APLICA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES
    (v_venta_id, v_prod_ruffles, 5, 0.50, 2.50);

    -- ══════════════════════════════════════════════════════════════════════════
    -- ESTA SEMANA (ayer + anteayer) — 4 ventas
    -- ══════════════════════════════════════════════════════════════════════════

    -- Venta 5: Ayer — Ruffles x10 + Yogur x3 — EFECTIVO
    INSERT INTO ventas (turno_id, cliente_id, empleado_id, fecha, subtotal, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago)
    VALUES (v_turno_id, v_cliente_id, v_empleado_id, ((v_hoy - 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '10 hours', 6.80, 6.80, 'EFECTIVO', 'TICKET', 1005, 'COMPLETADA', 'NO_APLICA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES
    (v_venta_id, v_prod_ruffles, 10, 0.50, 5.00),
    (v_venta_id, v_prod_yogur,    3, 0.60, 1.80);

    -- Venta 6: Ayer — Coca-Cola x4 — DEUNA
    INSERT INTO ventas (turno_id, cliente_id, empleado_id, fecha, subtotal, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago)
    VALUES (v_turno_id, v_cliente_id, v_empleado_id, ((v_hoy - 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '16 hours', 5.00, 5.00, 'DEUNA', 'TICKET', 1006, 'COMPLETADA', 'NO_APLICA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES
    (v_venta_id, v_prod_cola, 4, 1.25, 5.00);

    -- Venta 7: Anteayer — Yogur x5 + Ruffles x4 — EFECTIVO
    INSERT INTO ventas (turno_id, cliente_id, empleado_id, fecha, subtotal, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago)
    VALUES (v_turno_id, v_cliente_id, v_empleado_id, ((v_hoy - 2)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '12 hours', 5.00, 5.00, 'EFECTIVO', 'TICKET', 1007, 'COMPLETADA', 'NO_APLICA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES
    (v_venta_id, v_prod_yogur,   5, 0.60, 3.00),
    (v_venta_id, v_prod_ruffles, 4, 0.50, 2.00);

    -- Venta 8: Anteayer — Coca-Cola x6 — EFECTIVO
    INSERT INTO ventas (turno_id, cliente_id, empleado_id, fecha, subtotal, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago)
    VALUES (v_turno_id, v_cliente_id, v_empleado_id, ((v_hoy - 2)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '17 hours', 7.50, 7.50, 'EFECTIVO', 'TICKET', 1008, 'COMPLETADA', 'NO_APLICA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES
    (v_venta_id, v_prod_cola, 6, 1.25, 7.50);

    -- ══════════════════════════════════════════════════════════════════════════
    -- ESTE MES (hace 8 y 12 días) — 4 ventas
    -- ══════════════════════════════════════════════════════════════════════════

    -- Venta 9: hace 8 días — Coca-Cola x8 + Ruffles x6 — EFECTIVO
    INSERT INTO ventas (turno_id, cliente_id, empleado_id, fecha, subtotal, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago)
    VALUES (v_turno_id, v_cliente_id, v_empleado_id, ((v_hoy - 8)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '9 hours', 13.00, 13.00, 'EFECTIVO', 'NOTA_VENTA', 2001, 'COMPLETADA', 'NO_APLICA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES
    (v_venta_id, v_prod_cola,    8, 1.25, 10.00),
    (v_venta_id, v_prod_ruffles, 6, 0.50,  3.00);

    -- Venta 10: hace 8 días — Yogur x6 — TRANSFERENCIA
    INSERT INTO ventas (turno_id, cliente_id, empleado_id, fecha, subtotal, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago)
    VALUES (v_turno_id, v_cliente_id, v_empleado_id, ((v_hoy - 8)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '14 hours', 3.60, 3.60, 'TRANSFERENCIA', 'TICKET', 1009, 'COMPLETADA', 'NO_APLICA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES
    (v_venta_id, v_prod_yogur, 6, 0.60, 3.60);

    -- Venta 11: hace 12 días — Coca-Cola x10 — EFECTIVO
    INSERT INTO ventas (turno_id, cliente_id, empleado_id, fecha, subtotal, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago)
    VALUES (v_turno_id, v_cliente_id, v_empleado_id, ((v_hoy - 12)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '11 hours', 12.50, 12.50, 'EFECTIVO', 'TICKET', 1010, 'COMPLETADA', 'NO_APLICA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES
    (v_venta_id, v_prod_cola, 10, 1.25, 12.50);

    -- Venta 12: hace 12 días — Ruffles x12 + Yogur x4 — DEUNA
    INSERT INTO ventas (turno_id, cliente_id, empleado_id, fecha, subtotal, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago)
    VALUES (v_turno_id, v_cliente_id, v_empleado_id, ((v_hoy - 12)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '15 hours', 8.40, 8.40, 'DEUNA', 'TICKET', 1011, 'COMPLETADA', 'NO_APLICA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES
    (v_venta_id, v_prod_ruffles, 12, 0.50, 6.00),
    (v_venta_id, v_prod_yogur,    4, 0.60, 2.40);

    -- ══════════════════════════════════════════════════════════════════════════
    -- MES ANTERIOR (para "todo") — 3 ventas
    -- ══════════════════════════════════════════════════════════════════════════

    -- Venta 13: hace 35 días — Coca-Cola x15 — EFECTIVO
    INSERT INTO ventas (turno_id, cliente_id, empleado_id, fecha, subtotal, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago)
    VALUES (v_turno_id, v_cliente_id, v_empleado_id, ((v_hoy - 35)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '10 hours', 18.75, 18.75, 'EFECTIVO', 'TICKET', 1012, 'COMPLETADA', 'NO_APLICA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES
    (v_venta_id, v_prod_cola, 15, 1.25, 18.75);

    -- Venta 14: hace 35 días — Ruffles x20 — EFECTIVO
    INSERT INTO ventas (turno_id, cliente_id, empleado_id, fecha, subtotal, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago)
    VALUES (v_turno_id, v_cliente_id, v_empleado_id, ((v_hoy - 35)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '13 hours', 10.00, 10.00, 'EFECTIVO', 'TICKET', 1013, 'COMPLETADA', 'NO_APLICA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES
    (v_venta_id, v_prod_ruffles, 20, 0.50, 10.00);

    -- Venta 15: hace 35 días — Yogur x8 + Coca-Cola x5 — TRANSFERENCIA
    INSERT INTO ventas (turno_id, cliente_id, empleado_id, fecha, subtotal, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago)
    VALUES (v_turno_id, v_cliente_id, v_empleado_id, ((v_hoy - 35)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '16 hours', 11.05, 11.05, 'TRANSFERENCIA', 'TICKET', 1014, 'COMPLETADA', 'NO_APLICA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, subtotal) VALUES
    (v_venta_id, v_prod_yogur, 8, 0.60, 4.80),
    (v_venta_id, v_prod_cola,  5, 1.25, 6.25);

    RAISE NOTICE '✅ Seed completado: 15 ventas insertadas (14 COMPLETADAS + 1 ANULADA) en 4 períodos.';
    RAISE NOTICE '   Hoy:          3 ventas completadas + 1 anulada';
    RAISE NOTICE '   Esta semana:  4 ventas (ayer + anteayer)';
    RAISE NOTICE '   Este mes:     4 ventas (hace 8 y 12 días)';
    RAISE NOTICE '   Mes anterior: 3 ventas (hace 35 días)';
    RAISE NOTICE '';
    RAISE NOTICE '── Resultados esperados en fn_reporte_ventas_periodo ──';
    RAISE NOTICE '   Hoy:    total_monto=$12.20  top#1=Coca-Cola(8u)';
    RAISE NOTICE '   Semana: total_monto=$36.50  top#1=Coca-Cola(18u)';
    RAISE NOTICE '   Mes:    total_monto=$74.00  top#1=Coca-Cola(36u)';
    RAISE NOTICE '   Todo:   total_monto=$113.80 top#1=Coca-Cola(56u)';
END;
$$;
