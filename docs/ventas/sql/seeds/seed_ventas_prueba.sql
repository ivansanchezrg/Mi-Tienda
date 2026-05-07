-- ==========================================
-- SEED: Ventas de prueba — volumen completo
-- ==========================================
-- Propósito: poblar la sección de Ventas con datos realistas para validar:
--   · Resumen: KPIs, comparativas, gráficos, top productos, ventas por hora
--   · Listado: paginación, filtros, búsqueda, detalle
--   · Todos los métodos de pago y tipos de comprobante
--   · Alerta de anuladas (>5%), alerta de deuda (FIADO + cuentas_cobrar)
--   · Descuentos, clientes identificados, productos sin movimiento
--
-- ✅ IDEMPOTENTE: borra ventas del negocio activo y recrea desde cero.
--    Se puede ejecutar múltiples veces sin duplicados.
--
-- ✅ FUNCIONA DESDE SUPABASE SQL EDITOR: no usa get_negocio_id() (requiere JWT).
--    Resuelve el negocio por nombre o toma el único negocio existente.
--
-- PRE-REQUISITOS (en orden):
--   1. Schema ejecutado + RLS + funciones
--   2. Negocio creado desde la app (onboarding completo)
--   3. Turno ABIERTO en Caja (necesario para turno_id)
--   Si no hay turno abierto, el seed lo crea automáticamente como turno temporal.
--
-- ⚠️  IMPORTANTE: insertar directo en ventas + ventas_detalles (NO usa fn_registrar_venta_pos)
--    para evitar que los triggers afecten stock y caja. Solo prueba la UI de Ventas.
--
-- Cobertura de datos:
--   · 10 productos (distintos márgenes de ganancia)
--   · 5 clientes identificados + consumidor final
--   · ~150 ventas distribuidas en: hoy (16h), semana, mes, mes anterior
--   · Métodos: EFECTIVO, DEUNA, TRANSFERENCIA, FIADO
--   · Comprobantes: TICKET, NOTA_VENTA, FACTURA
--   · ~8% de anuladas → activa alerta de anuladas
--   · Ventas FIADO + cuentas_cobrar → activa alerta de deuda
--   · Ventas por hora distribuidas en 8 franjas → gráfico de hoy
--   · Período anterior poblado → comparativa funcional
-- ==========================================

DO $$
DECLARE
    -- ── IDs del negocio ───────────────────────────────────────────────────────
    v_negocio_id    UUID;
    v_turno_id      UUID;
    v_empleado_id   UUID;

    -- ── Clientes ──────────────────────────────────────────────────────────────
    v_cf            UUID;   -- consumidor final
    v_cli1          UUID;
    v_cli2          UUID;
    v_cli3          UUID;
    v_cli4          UUID;
    v_cli5          UUID;

    -- ── Productos (10) ────────────────────────────────────────────────────────
    v_p1            UUID;   -- Coca-Cola 600ml       costo 0.60 venta 1.25  margen 52%
    v_p2            UUID;   -- Ruffles original      costo 0.25 venta 0.75  margen 67%
    v_p3            UUID;   -- Yogur Toni 150g       costo 0.35 venta 0.65  margen 46%
    v_p4            UUID;   -- Agua Dasani 500ml     costo 0.20 venta 0.50  margen 60%
    v_p5            UUID;   -- Pan de molde Bimbo    costo 1.50 venta 2.25  margen 33%
    v_p6            UUID;   -- Leche Vita 1L         costo 0.80 venta 1.20  margen 33%
    v_p7            UUID;   -- Galletas Club Social  costo 0.40 venta 0.90  margen 56%
    v_p8            UUID;   -- Jabón Protex          costo 0.70 venta 1.50  margen 53%
    v_p9            UUID;   -- Aceite La Favorita 1L costo 2.80 venta 4.50  margen 38%
    v_p10           UUID;   -- Arroz 1 kg (sin movimiento hoy) costo 0.70 venta 1.00

    -- ── Categorías ────────────────────────────────────────────────────────────
    v_cat_bebidas   UUID;
    v_cat_snacks    UUID;
    v_cat_lacteos   UUID;
    v_cat_panaderia UUID;
    v_cat_limpieza  UUID;
    v_cat_despensa  UUID;

    -- ── Trabajo ───────────────────────────────────────────────────────────────
    v_venta_id      UUID;
    v_hoy           DATE;
    v_comp          INTEGER := 3001;   -- correlativo comprobante

BEGIN
    -- ── Resolución de negocio ─────────────────────────────────────────────────
    -- Sin JWT: resolvemos directo desde la tabla negocios.
    -- Si tienes más de un negocio, cambia el LIMIT 1 por:
    --   WHERE nombre = 'NombreDeTuNegocio'
    v_negocio_id := (SELECT id FROM negocios ORDER BY created_at LIMIT 1);

    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No existe ningún negocio. Crea el negocio desde la app primero.';
    END IF;

    v_hoy := (NOW() AT TIME ZONE 'America/Guayaquil')::DATE;

    -- ── Resolución de empleado (admin del negocio) ────────────────────────────
    v_empleado_id := (
        SELECT un.usuario_id
        FROM usuario_negocios un
        WHERE un.negocio_id = v_negocio_id
          AND un.rol = 'ADMIN'
        LIMIT 1
    );

    IF v_empleado_id IS NULL THEN
        -- fallback: cualquier usuario del negocio
        v_empleado_id := (
            SELECT un.usuario_id
            FROM usuario_negocios un
            WHERE un.negocio_id = v_negocio_id
            LIMIT 1
        );
    END IF;

    IF v_empleado_id IS NULL THEN
        RAISE EXCEPTION 'No se encontró ningún usuario para negocio_id = %. Completa el onboarding.', v_negocio_id;
    END IF;

    -- ── Deshabilitar triggers de ventas durante el seed ──────────────────────
    -- El seed inserta ventas con total = 0 y lo recalcula con UPDATE tras los
    -- detalles. Los triggers de caja (operaciones_cajas_monto_check exige > 0)
    -- y stock (descontaría inventario inexistente) chocan con ese patrón.
    -- Se reactivan al final del bloque.
    ALTER TABLE ventas           DISABLE TRIGGER trg_actualizar_caja_por_venta;
    ALTER TABLE ventas_detalles  DISABLE TRIGGER trg_descontar_stock_venta;

    -- ── Limpiar ventas anteriores del seed ───────────────────────────────────
    DELETE FROM cuentas_cobrar
     WHERE negocio_id = v_negocio_id
       AND observaciones LIKE 'SEED%';

    DELETE FROM ventas_detalles
     WHERE venta_id IN (
         SELECT id FROM ventas
          WHERE negocio_id = v_negocio_id
            AND observaciones LIKE 'SEED%'
     );

    DELETE FROM ventas
     WHERE negocio_id = v_negocio_id
       AND observaciones LIKE 'SEED%';

    -- ── Turno activo ──────────────────────────────────────────────────────────
    -- Usa el turno abierto. Si no hay ninguno, crea uno temporal para el seed.
    -- Lo ideal: abrir turno desde la app antes de ejecutar el seed.
    v_turno_id := (
        SELECT id FROM turnos_caja
        WHERE negocio_id = v_negocio_id
          AND hora_fecha_cierre IS NULL
        ORDER BY hora_fecha_apertura DESC
        LIMIT 1
    );

    IF v_turno_id IS NULL THEN
        RAISE NOTICE '⚠️  No hay turno abierto. Creando turno temporal para el seed...';
        INSERT INTO turnos_caja (negocio_id, numero_turno, empleado_id, hora_fecha_apertura)
        VALUES (v_negocio_id, 1, v_empleado_id, NOW() - INTERVAL '8 hours')
        RETURNING id INTO v_turno_id;
        RAISE NOTICE '   Turno temporal creado: %', v_turno_id;
    ELSE
        RAISE NOTICE '✅ Usando turno abierto: %', v_turno_id;
    END IF;

    -- ═══════════════════════════════════════════════════════════════════════════
    -- CATEGORÍAS
    -- ═══════════════════════════════════════════════════════════════════════════

    INSERT INTO categorias_productos (negocio_id, nombre)
    VALUES (v_negocio_id, 'Bebidas')
    ON CONFLICT (negocio_id, nombre) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id INTO v_cat_bebidas;

    INSERT INTO categorias_productos (negocio_id, nombre)
    VALUES (v_negocio_id, 'Snacks')
    ON CONFLICT (negocio_id, nombre) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id INTO v_cat_snacks;

    INSERT INTO categorias_productos (negocio_id, nombre)
    VALUES (v_negocio_id, 'Lácteos')
    ON CONFLICT (negocio_id, nombre) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id INTO v_cat_lacteos;

    INSERT INTO categorias_productos (negocio_id, nombre)
    VALUES (v_negocio_id, 'Panadería')
    ON CONFLICT (negocio_id, nombre) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id INTO v_cat_panaderia;

    INSERT INTO categorias_productos (negocio_id, nombre)
    VALUES (v_negocio_id, 'Limpieza')
    ON CONFLICT (negocio_id, nombre) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id INTO v_cat_limpieza;

    INSERT INTO categorias_productos (negocio_id, nombre)
    VALUES (v_negocio_id, 'Despensa')
    ON CONFLICT (negocio_id, nombre) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id INTO v_cat_despensa;

    -- ═══════════════════════════════════════════════════════════════════════════
    -- PRODUCTOS (insert si no existe — unicidad real en tabla codigos_barras)
    -- productos.codigo_barras no tiene UNIQUE propio; ON CONFLICT no aplica.
    -- Buscamos por codigos_barras.codigo y solo insertamos si no existe.
    -- ═══════════════════════════════════════════════════════════════════════════

    v_p1 := (SELECT cb.producto_id FROM codigos_barras cb WHERE cb.negocio_id = v_negocio_id AND cb.codigo = 'SEED-001' LIMIT 1);
    IF v_p1 IS NULL THEN
        INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, activo)
        VALUES (v_negocio_id, v_cat_bebidas, 'SEED-001', 'Coca-Cola 600ml', 0.60, 1.25, 100, 10, true)
        RETURNING id INTO v_p1;
    END IF;

    v_p2 := (SELECT cb.producto_id FROM codigos_barras cb WHERE cb.negocio_id = v_negocio_id AND cb.codigo = 'SEED-002' LIMIT 1);
    IF v_p2 IS NULL THEN
        INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, activo)
        VALUES (v_negocio_id, v_cat_snacks, 'SEED-002', 'Ruffles Original', 0.25, 0.75, 200, 20, true)
        RETURNING id INTO v_p2;
    END IF;

    v_p3 := (SELECT cb.producto_id FROM codigos_barras cb WHERE cb.negocio_id = v_negocio_id AND cb.codigo = 'SEED-003' LIMIT 1);
    IF v_p3 IS NULL THEN
        INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, activo)
        VALUES (v_negocio_id, v_cat_lacteos, 'SEED-003', 'Yogur Toni 150g', 0.35, 0.65, 80, 8, true)
        RETURNING id INTO v_p3;
    END IF;

    v_p4 := (SELECT cb.producto_id FROM codigos_barras cb WHERE cb.negocio_id = v_negocio_id AND cb.codigo = 'SEED-004' LIMIT 1);
    IF v_p4 IS NULL THEN
        INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, activo)
        VALUES (v_negocio_id, v_cat_bebidas, 'SEED-004', 'Agua Dasani 500ml', 0.20, 0.50, 150, 15, true)
        RETURNING id INTO v_p4;
    END IF;

    v_p5 := (SELECT cb.producto_id FROM codigos_barras cb WHERE cb.negocio_id = v_negocio_id AND cb.codigo = 'SEED-005' LIMIT 1);
    IF v_p5 IS NULL THEN
        INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, activo)
        VALUES (v_negocio_id, v_cat_panaderia, 'SEED-005', 'Pan de Molde Bimbo', 1.50, 2.25, 40, 5, true)
        RETURNING id INTO v_p5;
    END IF;

    v_p6 := (SELECT cb.producto_id FROM codigos_barras cb WHERE cb.negocio_id = v_negocio_id AND cb.codigo = 'SEED-006' LIMIT 1);
    IF v_p6 IS NULL THEN
        INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, activo)
        VALUES (v_negocio_id, v_cat_lacteos, 'SEED-006', 'Leche Vita 1L', 0.80, 1.20, 60, 6, true)
        RETURNING id INTO v_p6;
    END IF;

    v_p7 := (SELECT cb.producto_id FROM codigos_barras cb WHERE cb.negocio_id = v_negocio_id AND cb.codigo = 'SEED-007' LIMIT 1);
    IF v_p7 IS NULL THEN
        INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, activo)
        VALUES (v_negocio_id, v_cat_snacks, 'SEED-007', 'Galletas Club Social', 0.40, 0.90, 120, 12, true)
        RETURNING id INTO v_p7;
    END IF;

    v_p8 := (SELECT cb.producto_id FROM codigos_barras cb WHERE cb.negocio_id = v_negocio_id AND cb.codigo = 'SEED-008' LIMIT 1);
    IF v_p8 IS NULL THEN
        INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, activo)
        VALUES (v_negocio_id, v_cat_limpieza, 'SEED-008', 'Jabón Protex', 0.70, 1.50, 50, 5, true)
        RETURNING id INTO v_p8;
    END IF;

    v_p9 := (SELECT cb.producto_id FROM codigos_barras cb WHERE cb.negocio_id = v_negocio_id AND cb.codigo = 'SEED-009' LIMIT 1);
    IF v_p9 IS NULL THEN
        INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, activo)
        VALUES (v_negocio_id, v_cat_despensa, 'SEED-009', 'Aceite La Favorita 1L', 2.80, 4.50, 30, 3, true)
        RETURNING id INTO v_p9;
    END IF;

    -- p10: producto SIN movimiento hoy (solo aparece en semana/mes/todo)
    v_p10 := (SELECT cb.producto_id FROM codigos_barras cb WHERE cb.negocio_id = v_negocio_id AND cb.codigo = 'SEED-010' LIMIT 1);
    IF v_p10 IS NULL THEN
        INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, activo)
        VALUES (v_negocio_id, v_cat_despensa, 'SEED-010', 'Arroz Gustadina 1kg', 0.70, 1.00, 25, 5, true)
        RETURNING id INTO v_p10;
    END IF;

    -- ═══════════════════════════════════════════════════════════════════════════
    -- CLIENTES
    -- ═══════════════════════════════════════════════════════════════════════════

    -- Consumidor final
    v_cf := (SELECT id FROM clientes WHERE negocio_id = v_negocio_id AND es_consumidor_final = TRUE LIMIT 1);
    IF v_cf IS NULL THEN
        INSERT INTO clientes (negocio_id, nombre, es_consumidor_final)
        VALUES (v_negocio_id, 'Consumidor Final', TRUE)
        RETURNING id INTO v_cf;
    END IF;

    -- Clientes identificados (upsert por identificacion)
    INSERT INTO clientes (negocio_id, identificacion, nombre, telefono)
    VALUES (v_negocio_id, '1712345601', 'María García',    '0991111111')
    ON CONFLICT (negocio_id, identificacion) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id INTO v_cli1;

    INSERT INTO clientes (negocio_id, identificacion, nombre, telefono)
    VALUES (v_negocio_id, '1712345602', 'Juan Pérez',      '0992222222')
    ON CONFLICT (negocio_id, identificacion) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id INTO v_cli2;

    INSERT INTO clientes (negocio_id, identificacion, nombre, telefono)
    VALUES (v_negocio_id, '1712345603', 'Rosa Andrade',    '0993333333')
    ON CONFLICT (negocio_id, identificacion) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id INTO v_cli3;

    INSERT INTO clientes (negocio_id, identificacion, nombre, telefono)
    VALUES (v_negocio_id, '1712345604', 'Carlos Molina',   '0994444444')
    ON CONFLICT (negocio_id, identificacion) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id INTO v_cli4;

    INSERT INTO clientes (negocio_id, identificacion, nombre, telefono)
    VALUES (v_negocio_id, '1712345605', 'Lucía Herrera',   '0995555555')
    ON CONFLICT (negocio_id, identificacion) DO UPDATE SET nombre = EXCLUDED.nombre
    RETURNING id INTO v_cli5;

    -- ═══════════════════════════════════════════════════════════════════════════
    -- MACRO: función interna para insertar una venta + detalles
    -- (plpgsql no soporta macros, usamos una sub-función temporal vía tabla aux)
    -- En su lugar usamos bloques repetidos con variables claras.
    -- ═══════════════════════════════════════════════════════════════════════════

    -- ╔══════════════════════════════════════════════════════════════════════════╗
    -- ║  HOY — 16 ventas (13 COMPLETADAS + 3 ANULADAS = 19% anuladas → alerta) ║
    -- ║  Distribuidas en 8 franjas horarias para el gráfico de ventas por hora  ║
    -- ╚══════════════════════════════════════════════════════════════════════════╝

    -- 07h — apertura, cliente de paso
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cf, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '7 hours 15 min', 1.90, 0, 0, 1.90, 'EFECTIVO', 'TICKET', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-HOY')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p4, 2, 0.50, 0.20, 1.00),
           (v_venta_id, v_p2, 1, 0.75, 0.25, 0.75),
           (v_venta_id, v_p7, 0, 0.90, 0.40, 0.00); -- línea con 0 para probar edge case
    -- corregir: sin línea cero
    DELETE FROM ventas_detalles WHERE venta_id = v_venta_id AND cantidad = 0;

    -- 08h — desayuno, cliente María
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cli1, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '8 hours 5 min', 3.85, 0, 0, 3.85, 'EFECTIVO', 'TICKET', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-HOY')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p5, 1, 2.25, 1.50, 2.25),
           (v_venta_id, v_p6, 1, 1.20, 0.80, 1.20),
           (v_venta_id, v_p3, 1, 0.65, 0.35, 0.65);

    -- 08h — segunda venta mañana, consumidor final
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cf, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '8 hours 45 min', 2.50, 0, 0, 2.50, 'TRANSFERENCIA', 'TICKET', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-HOY')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p1, 2, 1.25, 0.60, 2.50);

    -- 10h — media mañana, Juan (con descuento 10%)
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cli2, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '10 hours 10 min', 9.00, 0.90, 10, 8.10, 'DEUNA', 'NOTA_VENTA', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-HOY')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p9, 2, 4.50, 2.80, 9.00);

    -- 10h — ANULADA (para activar alerta)
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cf, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '10 hours 30 min', 3.75, 0, 0, 3.75, 'EFECTIVO', 'TICKET', v_comp, 'ANULADA', 'NO_APLICA', 'SEED-HOY')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p1, 3, 1.25, 0.60, 3.75);

    -- 11h — almuerzo temprano, Rosa, FACTURA
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cli3, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '11 hours 20 min', 8.85, 0, 0, 8.85, 'TRANSFERENCIA', 'FACTURA', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-HOY')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p8, 3, 1.50, 0.70, 4.50),
           (v_venta_id, v_p6, 2, 1.20, 0.80, 2.40),
           (v_venta_id, v_p7, 2, 0.90, 0.40, 1.80),
           (v_venta_id, v_p3, 0.23, 0.65, 0.35, 0.15);
    -- quitar fracción para simplificar
    DELETE FROM ventas_detalles WHERE venta_id = v_venta_id AND cantidad < 1;
    UPDATE ventas SET subtotal = 8.70, total = 8.70 WHERE id = v_venta_id;

    -- 12h — hora pico, consumidor final, snacks
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cf, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '12 hours 5 min', 4.65, 0, 0, 4.65, 'EFECTIVO', 'TICKET', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-HOY')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p2, 3, 0.75, 0.25, 2.25),
           (v_venta_id, v_p7, 2, 0.90, 0.40, 1.80),
           (v_venta_id, v_p4, 1, 0.50, 0.20, 0.50),
           (v_venta_id, v_p3, 0, 0.65, 0.35, 0.00);
    DELETE FROM ventas_detalles WHERE venta_id = v_venta_id AND cantidad = 0;

    -- 12h — segunda venta hora pico, Carlos
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cli4, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '12 hours 40 min', 6.75, 0, 0, 6.75, 'EFECTIVO', 'TICKET', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-HOY')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p1, 3, 1.25, 0.60, 3.75),
           (v_venta_id, v_p5, 1, 2.25, 1.50, 2.25),
           (v_venta_id, v_p4, 1, 0.50, 0.20, 0.50),
           (v_venta_id, v_p3, 0, 0.65, 0.35, 0.00);
    DELETE FROM ventas_detalles WHERE venta_id = v_venta_id AND cantidad = 0;

    -- 12h — ANULADA segunda
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cf, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '12 hours 55 min', 4.50, 0, 0, 4.50, 'EFECTIVO', 'TICKET', v_comp, 'ANULADA', 'NO_APLICA', 'SEED-HOY')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p8, 3, 1.50, 0.70, 4.50);

    -- 14h — tarde, Lucía, FIADO (genera deuda)
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cli5, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '14 hours 10 min', 12.50, 0, 0, 12.50, 'FIADO', 'NOTA_VENTA', v_comp, 'COMPLETADA', 'PENDIENTE', 'SEED-HOY')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p9, 2, 4.50, 2.80, 9.00),
           (v_venta_id, v_p8, 2, 1.50, 0.70, 3.00),
           (v_venta_id, v_p6, 0, 1.20, 0.80, 0.00);
    DELETE FROM ventas_detalles WHERE venta_id = v_venta_id AND cantidad = 0;
    UPDATE ventas SET subtotal = 12.00, total = 12.00 WHERE id = v_venta_id;
    INSERT INTO cuentas_cobrar (negocio_id, venta_id, empleado_id, monto, metodo_pago, observaciones)
    VALUES (v_negocio_id, v_venta_id, v_empleado_id, 12.00, 'EFECTIVO', 'SEED-DEUDA');

    -- 14h — consumidor final, bebidas
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cf, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '14 hours 50 min', 3.75, 0, 0, 3.75, 'EFECTIVO', 'TICKET', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-HOY')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p1, 3, 1.25, 0.60, 3.75);

    -- 16h — tarde, María otra vez, DEUNA, con descuento 5%
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cli1, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '16 hours 5 min', 5.50, 0.28, 5, 5.22, 'DEUNA', 'TICKET', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-HOY')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p2, 4, 0.75, 0.25, 3.00),
           (v_venta_id, v_p7, 2, 0.90, 0.40, 1.80),
           (v_venta_id, v_p4, 1, 0.50, 0.20, 0.50),
           (v_venta_id, v_p3, 0, 0.65, 0.35, 0.00);
    DELETE FROM ventas_detalles WHERE venta_id = v_venta_id AND cantidad = 0;

    -- 17h — cierre tarde, Juan, FIADO (segunda deuda)
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cli2, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '17 hours 30 min', 8.25, 0, 0, 8.25, 'FIADO', 'TICKET', v_comp, 'COMPLETADA', 'PENDIENTE', 'SEED-HOY')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p5, 2, 2.25, 1.50, 4.50),
           (v_venta_id, v_p6, 2, 1.20, 0.80, 2.40),
           (v_venta_id, v_p3, 2, 0.65, 0.35, 1.30),
           (v_venta_id, v_p4, 0, 0.50, 0.20, 0.00);
    DELETE FROM ventas_detalles WHERE venta_id = v_venta_id AND cantidad = 0;
    UPDATE ventas SET subtotal = 8.20, total = 8.20 WHERE id = v_venta_id;
    INSERT INTO cuentas_cobrar (negocio_id, venta_id, empleado_id, monto, metodo_pago, observaciones)
    VALUES (v_negocio_id, v_venta_id, v_empleado_id, 8.20, 'EFECTIVO', 'SEED-DEUDA');

    -- 17h — consumidor final, compra rápida
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cf, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '17 hours 55 min', 2.25, 0, 0, 2.25, 'EFECTIVO', 'TICKET', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-HOY')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p2, 1, 0.75, 0.25, 0.75),
           (v_venta_id, v_p3, 1, 0.65, 0.35, 0.65),
           (v_venta_id, v_p4, 1, 0.50, 0.20, 0.50),
           (v_venta_id, v_p7, 0, 0.90, 0.40, 0.00);
    DELETE FROM ventas_detalles WHERE venta_id = v_venta_id AND cantidad = 0;

    -- 19h — noche, Rosa, FACTURA
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cli3, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '19 hours 10 min', 15.75, 0, 0, 15.75, 'TRANSFERENCIA', 'FACTURA', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-HOY')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p9, 2, 4.50, 2.80, 9.00),
           (v_venta_id, v_p5, 2, 2.25, 1.50, 4.50),
           (v_venta_id, v_p8, 1, 1.50, 0.70, 1.50),
           (v_venta_id, v_p6, 0, 1.20, 0.80, 0.00);
    DELETE FROM ventas_detalles WHERE venta_id = v_venta_id AND cantidad = 0;
    UPDATE ventas SET subtotal = 15.00, total = 15.00 WHERE id = v_venta_id;

    -- 20h — cierre, ANULADA tercera
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cf, v_empleado_id, (v_hoy::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '20 hours 5 min', 6.00, 0, 0, 6.00, 'EFECTIVO', 'TICKET', v_comp, 'ANULADA', 'NO_APLICA', 'SEED-HOY')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p1, 4, 1.25, 0.60, 5.00),
           (v_venta_id, v_p4, 2, 0.50, 0.20, 1.00);

    -- ╔══════════════════════════════════════════════════════════════════════════╗
    -- ║  AYER — 12 ventas (10 COMPLETADAS + 2 ANULADAS)                        ║
    -- ║  Período anterior de HOY para que la comparativa sea significativa       ║
    -- ╚══════════════════════════════════════════════════════════════════════════╝

    -- Ayer 08h
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cf, v_empleado_id, ((v_hoy - 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '8 hours', 2.50, 0, 0, 2.50, 'EFECTIVO', 'TICKET', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-SEMANA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p1, 2, 1.25, 0.60, 2.50);

    -- Ayer 09h, María
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cli1, v_empleado_id, ((v_hoy - 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '9 hours', 4.05, 0, 0, 4.05, 'DEUNA', 'TICKET', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-SEMANA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p3, 3, 0.65, 0.35, 1.95),
           (v_venta_id, v_p6, 1, 1.20, 0.80, 1.20),
           (v_venta_id, v_p5, 0, 2.25, 1.50, 0.00);
    DELETE FROM ventas_detalles WHERE venta_id = v_venta_id AND cantidad = 0;
    UPDATE ventas SET subtotal = 3.15, total = 3.15 WHERE id = v_venta_id;

    -- Ayer 11h
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cf, v_empleado_id, ((v_hoy - 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '11 hours', 6.75, 0, 0, 6.75, 'EFECTIVO', 'TICKET', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-SEMANA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p2, 5, 0.75, 0.25, 3.75),
           (v_venta_id, v_p7, 2, 0.90, 0.40, 1.80),
           (v_venta_id, v_p4, 2, 0.50, 0.20, 1.00),
           (v_venta_id, v_p3, 0, 0.65, 0.35, 0.00);
    DELETE FROM ventas_detalles WHERE venta_id = v_venta_id AND cantidad = 0;
    UPDATE ventas SET subtotal = 6.55, total = 6.55 WHERE id = v_venta_id;

    -- Ayer 12h, Juan, ANULADA
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cli2, v_empleado_id, ((v_hoy - 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '12 hours', 5.00, 0, 0, 5.00, 'EFECTIVO', 'TICKET', v_comp, 'ANULADA', 'NO_APLICA', 'SEED-SEMANA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p1, 4, 1.25, 0.60, 5.00);

    -- Ayer 13h, Carlos
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cli4, v_empleado_id, ((v_hoy - 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '13 hours', 9.00, 0, 0, 9.00, 'TRANSFERENCIA', 'NOTA_VENTA', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-SEMANA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p9, 2, 4.50, 2.80, 9.00);

    -- Ayer 14h
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cf, v_empleado_id, ((v_hoy - 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '14 hours', 3.00, 0, 0, 3.00, 'EFECTIVO', 'TICKET', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-SEMANA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p8, 2, 1.50, 0.70, 3.00);

    -- Ayer 16h, Lucía, FIADO
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cli5, v_empleado_id, ((v_hoy - 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '16 hours', 7.50, 0, 0, 7.50, 'FIADO', 'TICKET', v_comp, 'COMPLETADA', 'PENDIENTE', 'SEED-SEMANA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p5, 2, 2.25, 1.50, 4.50),
           (v_venta_id, v_p6, 2, 1.20, 0.80, 2.40),
           (v_venta_id, v_p3, 0, 0.65, 0.35, 0.00);
    DELETE FROM ventas_detalles WHERE venta_id = v_venta_id AND cantidad = 0;
    UPDATE ventas SET subtotal = 6.90, total = 6.90 WHERE id = v_venta_id;
    INSERT INTO cuentas_cobrar (negocio_id, venta_id, empleado_id, monto, metodo_pago, observaciones)
    VALUES (v_negocio_id, v_venta_id, v_empleado_id, 6.90, 'EFECTIVO', 'SEED-DEUDA');

    -- Ayer 17h
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cf, v_empleado_id, ((v_hoy - 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '17 hours', 4.50, 0, 0, 4.50, 'EFECTIVO', 'TICKET', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-SEMANA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p1, 2, 1.25, 0.60, 2.50),
           (v_venta_id, v_p2, 2, 0.75, 0.25, 1.50),
           (v_venta_id, v_p4, 1, 0.50, 0.20, 0.50);

    -- Ayer 18h, ANULADA
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cf, v_empleado_id, ((v_hoy - 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '18 hours', 2.25, 0, 0, 2.25, 'EFECTIVO', 'TICKET', v_comp, 'ANULADA', 'NO_APLICA', 'SEED-SEMANA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p2, 3, 0.75, 0.25, 2.25);

    -- Ayer 19h, Rosa, FACTURA con descuento
    v_comp := v_comp + 1;
    INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
    VALUES (v_negocio_id, v_turno_id, v_cli3, v_empleado_id, ((v_hoy - 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '19 hours', 18.00, 1.80, 10, 16.20, 'TRANSFERENCIA', 'FACTURA', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-SEMANA')
    RETURNING id INTO v_venta_id;
    INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
    VALUES (v_venta_id, v_p9, 4, 4.50, 2.80, 18.00);

    -- ╔══════════════════════════════════════════════════════════════════════════╗
    -- ║  ESTA SEMANA (hace 2-5 días) — 25 ventas variadas                       ║
    -- ╚══════════════════════════════════════════════════════════════════════════╝

    -- Hace 2 días
    FOR i IN 1..5 LOOP
        v_comp := v_comp + 1;
        INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
        VALUES (
            v_negocio_id, v_turno_id,
            CASE i % 3 WHEN 0 THEN v_cf WHEN 1 THEN v_cli1 ELSE v_cli2 END,
            v_empleado_id,
            ((v_hoy - 2)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + (INTERVAL '8 hours' * i),
            ROUND((2.50 + i * 1.75)::numeric, 2), 0, 0,
            ROUND((2.50 + i * 1.75)::numeric, 2),
            (CASE i % 4 WHEN 0 THEN 'EFECTIVO' WHEN 1 THEN 'DEUNA' WHEN 2 THEN 'TRANSFERENCIA' ELSE 'EFECTIVO' END)::VARCHAR,
            'TICKET', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-SEMANA'
        )
        RETURNING id INTO v_venta_id;
        INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
        VALUES (v_venta_id, v_p1, i, 1.25, 0.60, ROUND((i * 1.25)::numeric, 2)),
               (v_venta_id, v_p2, i, 0.75, 0.25, ROUND((i * 0.75)::numeric, 2));
        UPDATE ventas SET subtotal = ROUND((i * 1.25 + i * 0.75)::numeric, 2),
                          total    = ROUND((i * 1.25 + i * 0.75)::numeric, 2)
        WHERE id = v_venta_id;
    END LOOP;

    -- Hace 3 días
    FOR i IN 1..6 LOOP
        v_comp := v_comp + 1;
        INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
        VALUES (
            v_negocio_id, v_turno_id,
            CASE i % 3 WHEN 0 THEN v_cf WHEN 1 THEN v_cli3 ELSE v_cli4 END,
            v_empleado_id,
            ((v_hoy - 3)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + (INTERVAL '9 hours' + INTERVAL '1 hour' * i),
            0, 0, 0, 0,
            (CASE i % 2 WHEN 0 THEN 'EFECTIVO' ELSE 'TRANSFERENCIA' END)::VARCHAR,
            (CASE i % 3 WHEN 0 THEN 'NOTA_VENTA' ELSE 'TICKET' END)::tipo_comprobante_enum,
            v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-SEMANA'
        )
        RETURNING id INTO v_venta_id;
        INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
        VALUES (v_venta_id, v_p7, i + 1, 0.90, 0.40, ROUND(((i + 1) * 0.90)::numeric, 2)),
               (v_venta_id, v_p8, i,     1.50, 0.70, ROUND((i * 1.50)::numeric, 2)),
               (v_venta_id, v_p3, i,     0.65, 0.35, ROUND((i * 0.65)::numeric, 2));
        UPDATE ventas SET subtotal = ROUND(((i+1)*0.90 + i*1.50 + i*0.65)::numeric, 2),
                          total    = ROUND(((i+1)*0.90 + i*1.50 + i*0.65)::numeric, 2)
        WHERE id = v_venta_id;
    END LOOP;

    -- Hace 4 días (incluye Aceite y Pan para subir top productos)
    FOR i IN 1..7 LOOP
        v_comp := v_comp + 1;
        INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
        VALUES (
            v_negocio_id, v_turno_id,
            CASE i % 2 WHEN 0 THEN v_cf ELSE v_cli5 END,
            v_empleado_id,
            ((v_hoy - 4)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + (INTERVAL '7 hours' + INTERVAL '90 min' * i),
            0, 0, 0, 0,
            (CASE i % 3 WHEN 0 THEN 'DEUNA' WHEN 1 THEN 'EFECTIVO' ELSE 'TRANSFERENCIA' END)::VARCHAR,
            'TICKET'::tipo_comprobante_enum, v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-SEMANA'
        )
        RETURNING id INTO v_venta_id;
        INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
        VALUES (v_venta_id, v_p9, i, 4.50, 2.80, ROUND((i * 4.50)::numeric, 2)),
               (v_venta_id, v_p5, i, 2.25, 1.50, ROUND((i * 2.25)::numeric, 2));
        UPDATE ventas SET subtotal = ROUND((i * 4.50 + i * 2.25)::numeric, 2),
                          total    = ROUND((i * 4.50 + i * 2.25)::numeric, 2)
        WHERE id = v_venta_id;
    END LOOP;

    -- Hace 5 días
    FOR i IN 1..7 LOOP
        v_comp := v_comp + 1;
        INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
        VALUES (
            v_negocio_id, v_turno_id,
            CASE i % 4 WHEN 0 THEN v_cf WHEN 1 THEN v_cli1 WHEN 2 THEN v_cli2 ELSE v_cli3 END,
            v_empleado_id,
            ((v_hoy - 5)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + (INTERVAL '8 hours' + INTERVAL '1 hour 10 min' * i),
            0, 0, 0, 0,
            (CASE i % 2 WHEN 0 THEN 'EFECTIVO' ELSE 'DEUNA' END)::VARCHAR,
            'TICKET'::tipo_comprobante_enum, v_comp,
            (CASE i WHEN 3 THEN 'ANULADA' ELSE 'COMPLETADA' END)::VARCHAR,
            'NO_APLICA', 'SEED-SEMANA'
        )
        RETURNING id INTO v_venta_id;
        INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
        VALUES (v_venta_id, v_p4, i * 2, 0.50, 0.20, ROUND((i * 2 * 0.50)::numeric, 2)),
               (v_venta_id, v_p6, i,     1.20, 0.80, ROUND((i * 1.20)::numeric, 2)),
               (v_venta_id, v_p2, i,     0.75, 0.25, ROUND((i * 0.75)::numeric, 2));
        UPDATE ventas SET subtotal = ROUND((i*2*0.50 + i*1.20 + i*0.75)::numeric, 2),
                          total    = ROUND((i*2*0.50 + i*1.20 + i*0.75)::numeric, 2)
        WHERE id = v_venta_id;
    END LOOP;

    -- ╔══════════════════════════════════════════════════════════════════════════╗
    -- ║  ESTE MES (hace 7-25 días) — ~50 ventas                                 ║
    -- ╚══════════════════════════════════════════════════════════════════════════╝

    FOR dia IN 7..25 LOOP
        FOR i IN 1..(2 + (dia % 4)) LOOP
            v_comp := v_comp + 1;
            INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
            VALUES (
                v_negocio_id, v_turno_id,
                CASE (dia + i) % 5
                    WHEN 0 THEN v_cf
                    WHEN 1 THEN v_cli1
                    WHEN 2 THEN v_cli2
                    WHEN 3 THEN v_cli3
                    ELSE v_cf
                END,
                v_empleado_id,
                ((v_hoy - dia)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + (INTERVAL '9 hours' + INTERVAL '2 hours' * i),
                0, 0, 0, 0,
                (CASE (dia * i) % 4
                    WHEN 0 THEN 'EFECTIVO'
                    WHEN 1 THEN 'DEUNA'
                    WHEN 2 THEN 'TRANSFERENCIA'
                    ELSE 'EFECTIVO'
                END)::VARCHAR,
                (CASE (dia + i) % 3
                    WHEN 0 THEN 'NOTA_VENTA'
                    WHEN 1 THEN 'FACTURA'
                    ELSE 'TICKET'
                END)::tipo_comprobante_enum,
                v_comp,
                (CASE WHEN (dia % 8 = 0 AND i = 1) THEN 'ANULADA' ELSE 'COMPLETADA' END)::VARCHAR,
                'NO_APLICA', 'SEED-MES'
            )
            RETURNING id INTO v_venta_id;

            INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
            VALUES
                (v_venta_id, v_p1, (i + dia % 3) + 1,  1.25, 0.60, ROUND(((i + dia % 3 + 1) * 1.25)::numeric, 2)),
                (v_venta_id, v_p2, (i % 4) + 1,         0.75, 0.25, ROUND((((i % 4) + 1) * 0.75)::numeric, 2)),
                (v_venta_id, v_p9, (dia % 3) + 1,        4.50, 2.80, ROUND((((dia % 3) + 1) * 4.50)::numeric, 2));

            UPDATE ventas
            SET subtotal = ROUND(((i + dia%3 + 1)*1.25 + ((i%4)+1)*0.75 + ((dia%3)+1)*4.50)::numeric, 2),
                total    = ROUND(((i + dia%3 + 1)*1.25 + ((i%4)+1)*0.75 + ((dia%3)+1)*4.50)::numeric, 2)
            WHERE id = v_venta_id;
        END LOOP;
    END LOOP;

    -- Ventas del Arroz (p10) solo en el mes, no hoy → aparece en "sin movimiento hoy"
    FOR dia IN 10..20 LOOP
        v_comp := v_comp + 1;
        INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
        VALUES (v_negocio_id, v_turno_id, v_cf, v_empleado_id,
                ((v_hoy - dia)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '10 hours',
                ROUND((3 * 1.00)::numeric, 2), 0, 0, 3.00,
                'EFECTIVO', 'TICKET', v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-MES')
        RETURNING id INTO v_venta_id;
        INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
        VALUES (v_venta_id, v_p10, 3, 1.00, 0.70, 3.00);
    END LOOP;

    -- ╔══════════════════════════════════════════════════════════════════════════╗
    -- ║  MES ANTERIOR (hace 31-60 días) — ~30 ventas                            ║
    -- ╚══════════════════════════════════════════════════════════════════════════╝

    FOR dia IN 31..60 LOOP
        EXIT WHEN dia > 60;
        IF (dia % 3) = 0 THEN  -- no todos los días, simula fin de semana libre
            CONTINUE;
        END IF;
        v_comp := v_comp + 1;
        INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
        VALUES (
            v_negocio_id, v_turno_id,
            CASE dia % 3 WHEN 0 THEN v_cf WHEN 1 THEN v_cli4 ELSE v_cli5 END,
            v_empleado_id,
            ((v_hoy - dia)::TIMESTAMP AT TIME ZONE 'America/Guayaquil') + INTERVAL '11 hours',
            0, 0, 0, 0,
            (CASE dia % 2 WHEN 0 THEN 'EFECTIVO' ELSE 'TRANSFERENCIA' END)::VARCHAR,
            'TICKET'::tipo_comprobante_enum, v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-TODO'
        )
        RETURNING id INTO v_venta_id;
        INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
        VALUES (v_venta_id, v_p1, (dia % 5) + 2, 1.25, 0.60, ROUND((((dia % 5) + 2) * 1.25)::numeric, 2)),
               (v_venta_id, v_p6, (dia % 3) + 1, 1.20, 0.80, ROUND((((dia % 3) + 1) * 1.20)::numeric, 2)),
               (v_venta_id, v_p8, (dia % 4) + 1, 1.50, 0.70, ROUND((((dia % 4) + 1) * 1.50)::numeric, 2));
        UPDATE ventas
        SET subtotal = ROUND((((dia%5)+2)*1.25 + ((dia%3)+1)*1.20 + ((dia%4)+1)*1.50)::numeric, 2),
            total    = ROUND((((dia%5)+2)*1.25 + ((dia%3)+1)*1.20 + ((dia%4)+1)*1.50)::numeric, 2)
        WHERE id = v_venta_id;
    END LOOP;

    -- ╔══════════════════════════════════════════════════════════════════════════╗
    -- ║  AÑO 2024 — ~120 ventas distribuidas en todos los meses                 ║
    -- ║  Volumen menor que 2025 para que la comparativa "vs. año anterior"      ║
    -- ║  muestre crecimiento real al filtrar por año actual.                    ║
    -- ╚══════════════════════════════════════════════════════════════════════════╝

    FOR mes IN 1..12 LOOP
        FOR dia IN 1..28 LOOP
            CONTINUE WHEN (dia % 4) = 0;   -- ~75% de los días tienen venta
            v_comp := v_comp + 1;
            INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
            VALUES (
                v_negocio_id, v_turno_id,
                CASE (mes + dia) % 4 WHEN 0 THEN v_cf WHEN 1 THEN v_cli1 WHEN 2 THEN v_cli3 ELSE v_cf END,
                v_empleado_id,
                (make_timestamp(2024, mes, dia, 9 + (dia % 8), 0, 0) AT TIME ZONE 'America/Guayaquil'),
                0, 0, 0, 0,
                (CASE (mes * dia) % 3 WHEN 0 THEN 'EFECTIVO' WHEN 1 THEN 'TRANSFERENCIA' ELSE 'EFECTIVO' END)::VARCHAR,
                (CASE (mes + dia) % 3 WHEN 0 THEN 'NOTA_VENTA' WHEN 1 THEN 'FACTURA' ELSE 'TICKET' END)::tipo_comprobante_enum,
                v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-2024'
            )
            RETURNING id INTO v_venta_id;
            INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
            VALUES (v_venta_id, v_p1, (dia % 4) + 1, 1.25, 0.60, ROUND((((dia % 4) + 1) * 1.25)::numeric, 2)),
                   (v_venta_id, v_p6, (mes % 3) + 1, 1.20, 0.80, ROUND((((mes % 3) + 1) * 1.20)::numeric, 2)),
                   (v_venta_id, v_p9, (dia % 2) + 1, 4.50, 2.80, ROUND((((dia % 2) + 1) * 4.50)::numeric, 2));
            UPDATE ventas
            SET subtotal = ROUND((((dia%4)+1)*1.25 + ((mes%3)+1)*1.20 + ((dia%2)+1)*4.50)::numeric, 2),
                total    = ROUND((((dia%4)+1)*1.25 + ((mes%3)+1)*1.20 + ((dia%2)+1)*4.50)::numeric, 2)
            WHERE id = v_venta_id;
        END LOOP;
    END LOOP;

    -- ╔══════════════════════════════════════════════════════════════════════════╗
    -- ║  AÑO 2023 — ~80 ventas (volumen más bajo, negocio más nuevo)            ║
    -- ╚══════════════════════════════════════════════════════════════════════════╝

    FOR mes IN 1..12 LOOP
        FOR dia IN 1..20 LOOP
            CONTINUE WHEN (dia % 3) = 0;
            v_comp := v_comp + 1;
            INSERT INTO ventas (negocio_id, turno_id, cliente_id, empleado_id, fecha, subtotal, descuento, descuento_pct, total, metodo_pago, tipo_comprobante, numero_comprobante, estado, estado_pago, observaciones)
            VALUES (
                v_negocio_id, v_turno_id,
                CASE dia % 3 WHEN 0 THEN v_cf WHEN 1 THEN v_cli2 ELSE v_cli4 END,
                v_empleado_id,
                (make_timestamp(2023, mes, dia, 10 + (dia % 6), 0, 0) AT TIME ZONE 'America/Guayaquil'),
                0, 0, 0, 0,
                (CASE dia % 2 WHEN 0 THEN 'EFECTIVO' ELSE 'TRANSFERENCIA' END)::VARCHAR,
                'TICKET'::tipo_comprobante_enum,
                v_comp, 'COMPLETADA', 'NO_APLICA', 'SEED-2023'
            )
            RETURNING id INTO v_venta_id;
            INSERT INTO ventas_detalles (venta_id, producto_id, cantidad, precio_unitario, precio_costo, subtotal)
            VALUES (v_venta_id, v_p1, (dia % 3) + 1, 1.25, 0.60, ROUND((((dia % 3) + 1) * 1.25)::numeric, 2)),
                   (v_venta_id, v_p2, (mes % 4) + 1, 0.75, 0.25, ROUND((((mes % 4) + 1) * 0.75)::numeric, 2)),
                   (v_venta_id, v_p8, (dia % 2) + 1, 1.50, 0.70, ROUND((((dia % 2) + 1) * 1.50)::numeric, 2));
            UPDATE ventas
            SET subtotal = ROUND((((dia%3)+1)*1.25 + ((mes%4)+1)*0.75 + ((dia%2)+1)*1.50)::numeric, 2),
                total    = ROUND((((dia%3)+1)*1.25 + ((mes%4)+1)*0.75 + ((dia%2)+1)*1.50)::numeric, 2)
            WHERE id = v_venta_id;
        END LOOP;
    END LOOP;

    -- ── Reactivar triggers ───────────────────────────────────────────────────
    ALTER TABLE ventas           ENABLE TRIGGER trg_actualizar_caja_por_venta;
    ALTER TABLE ventas_detalles  ENABLE TRIGGER trg_descontar_stock_venta;

    -- ═══════════════════════════════════════════════════════════════════════════
    RAISE NOTICE '✅ Seed completado correctamente';
    RAISE NOTICE '   Negocio: %', v_negocio_id;
    RAISE NOTICE '   Productos creados: 10 (SEED-001 a SEED-010)';
    RAISE NOTICE '   Clientes creados: 5 identificados + consumidor final';
    RAISE NOTICE '   Ventas HOY:          ~16 (13 completadas + 3 anuladas)';
    RAISE NOTICE '   Ventas SEMANA:       ~37 (incluyendo ayer)';
    RAISE NOTICE '   Ventas MES:          ~87 (incluyendo semana)';
    RAISE NOTICE '   Ventas MES ANT/TODO: ~107+ (incluyendo mes)';
    RAISE NOTICE '   Ventas 2024:         ~120 (distribuidas en 12 meses)';
    RAISE NOTICE '   Ventas 2023:         ~80  (distribuidas en 12 meses)';
    RAISE NOTICE '   Deudas FIADO:        3 en cuentas_cobrar (~$27.10)';
    RAISE NOTICE '   Métodos: EFECTIVO, DEUNA, TRANSFERENCIA, FIADO';
    RAISE NOTICE '   Comprobantes: TICKET, NOTA_VENTA, FACTURA';
    RAISE NOTICE '   p10 (Arroz) sin movimiento HOY → aparece en alerta';

END;
$$;
