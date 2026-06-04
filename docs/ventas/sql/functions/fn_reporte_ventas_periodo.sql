-- ==========================================
-- DROP — firmas anteriores
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_reporte_ventas_periodo(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_reporte_ventas_periodo(TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.fn_reporte_ventas_periodo(TEXT, TEXT, UUID, INTEGER);

-- ==========================================
-- FUNCIÓN: fn_reporte_ventas_periodo (v1.9 — performance: consolidación de agregados)
-- ==========================================
-- v1.9 (2026-05-30) — PERFORMANCE:
--   Consolida 6 SELECTs idénticos sobre `ventas` en 1 único query con COUNT/SUM FILTER.
--   Consolida 2 SELECTs sobre `ventas_detalles` (costo + ganancia) en 1 query.
--   Consolida 3 SELECTs del período anterior en 2 queries (ventas + detalles).
--   Reducción: 11 queries redundantes → 4 queries. El contrato del JSON de salida
--   no cambia — todos los campos antiguos siguen presentes con el mismo nombre.
--
-- v1.8 — Agrega productos_baja_rotacion: top 5 productos activos con menos
--         unidades vendidas en el período (incluye los que tienen 0 ventas via LEFT JOIN).
--
-- v1.7 — Agrega métricas para dashboard ejecutivo:
--   - ticket_promedio                 (total_monto / total_ventas)
--   - total_monto_anterior            (mismo rango, período anterior)
--   - total_ventas_anterior
--   - ganancia_anterior
--   - top_productos_rentables         (top 5 por ganancia, no por ingreso)
--   - ventas_por_hora                 (solo cuando rango es 1 día)
--   - productos_sin_movimiento        (cuántos productos activos no se vendieron)
--
-- v1.6 — Agrega filtro explícito negocio_id = get_negocio_id() en todas las queries.
-- v1.5 — Agrega total_descuentos y clientes_unicos.
-- v1.4 — Usa vd.precio_costo (snapshot histórico en ventas_detalles).
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_reporte_ventas_periodo(
    p_fecha_inicio TEXT,
    p_fecha_fin    TEXT,
    p_turno_id     UUID    DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id           UUID;
    v_inicio               TIMESTAMPTZ;
    v_fin                  TIMESTAMPTZ;
    v_dias_rango           INTEGER;
    v_inicio_anterior      TIMESTAMPTZ;
    v_fin_anterior         TIMESTAMPTZ;

    -- Agregados consolidados (single-row records)
    v_actuales             RECORD;  -- COUNTs/SUMs período actual sobre ventas
    v_detalles_actuales    RECORD;  -- costo + ganancia actual sobre ventas_detalles
    v_anteriores           RECORD;  -- COUNT + SUM período anterior sobre ventas
    v_detalles_anteriores  RECORD;  -- ganancia anterior sobre ventas_detalles

    -- Métricas derivadas
    v_margen_pct           NUMERIC(5,2);
    v_ticket_promedio      NUMERIC(12,2);

    -- Métricas calculadas por separado (no consolidables)
    v_sin_movimiento       BIGINT;
    v_baja_rotacion        JSON;
    v_por_metodo           JSON;
    v_por_comprobante      JSON;
    v_top_ingreso          JSON;
    v_top_rentables        JSON;
    v_ventas_por_hora      JSON;
BEGIN
    v_negocio_id := public.get_negocio_id();

    -- Defensa en profundidad: validar que p_turno_id (si viene) pertenece al negocio activo.
    IF p_turno_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM turnos_caja WHERE id = p_turno_id AND negocio_id = v_negocio_id
    ) THEN
        RAISE EXCEPTION 'El turno especificado no pertenece a este negocio';
    END IF;

    -- Rango actual (exclusivo al final)
    v_inicio := (p_fecha_inicio::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    v_fin    := ((p_fecha_fin::DATE + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

    -- Rango anterior (mismos días, retrocedido)
    v_dias_rango := (p_fecha_fin::DATE - p_fecha_inicio::DATE) + 1;
    v_inicio_anterior := ((p_fecha_inicio::DATE - v_dias_rango)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    v_fin_anterior    := (p_fecha_inicio::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

    -- ── Bloque 1: Agregados período actual sobre `ventas` (1 query) ──────────
    -- Reemplaza 6 SELECTs idénticos con un solo scan + COUNT/SUM FILTER.
    FOR v_actuales IN
        SELECT
            COALESCE(COUNT(*) FILTER (WHERE estado = 'COMPLETADA'), 0)::BIGINT          AS total_ventas,
            COALESCE(SUM(total) FILTER (WHERE estado = 'COMPLETADA'), 0)::NUMERIC(12,2) AS total_monto,
            COALESCE(COUNT(*) FILTER (WHERE estado = 'ANULADA'), 0)::BIGINT             AS total_anuladas,
            COALESCE(SUM(total) FILTER (WHERE estado = 'ANULADA'), 0)::NUMERIC(12,2)    AS monto_anulado,
            COALESCE(SUM(descuento) FILTER (WHERE estado = 'COMPLETADA'), 0)::NUMERIC(12,2) AS total_descuentos,
            COALESCE(
                COUNT(DISTINCT cliente_id) FILTER (WHERE estado = 'COMPLETADA' AND cliente_id IS NOT NULL),
                0
            )::BIGINT                                                                   AS clientes_unicos
        FROM ventas
        WHERE negocio_id = v_negocio_id
          AND (p_turno_id IS NULL OR turno_id = p_turno_id)
          AND fecha >= v_inicio
          AND fecha <  v_fin
    LOOP
        EXIT; -- single-row
    END LOOP;

    -- ── Bloque 2: Costo + ganancia actual sobre `ventas_detalles` (1 query) ──
    -- Reemplaza 2 SELECTs sobre el mismo JOIN.
    FOR v_detalles_actuales IN
        SELECT
            COALESCE(SUM(vd.precio_costo * vd.cantidad), 0)::NUMERIC(12,2)                                AS costo_total,
            COALESCE(SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad), 0)::NUMERIC(12,2)         AS ganancia_bruta
        FROM ventas_detalles vd
        JOIN ventas v ON v.id = vd.venta_id
        WHERE v.negocio_id = v_negocio_id
          AND v.estado = 'COMPLETADA'
          AND (p_turno_id IS NULL OR v.turno_id = p_turno_id)
          AND v.fecha >= v_inicio AND v.fecha < v_fin
    LOOP
        EXIT;
    END LOOP;

    -- Métricas derivadas
    v_margen_pct      := CASE WHEN v_actuales.total_monto > 0
                              THEN ROUND((v_detalles_actuales.ganancia_bruta / v_actuales.total_monto) * 100, 2)
                              ELSE 0 END;
    v_ticket_promedio := CASE WHEN v_actuales.total_ventas > 0
                              THEN ROUND(v_actuales.total_monto / v_actuales.total_ventas, 2)
                              ELSE 0 END;

    -- ── Bloque 3: Agregados período anterior sobre `ventas` (1 query) ─────────
    -- Reemplaza 2 SELECTs idénticos.
    FOR v_anteriores IN
        SELECT
            COALESCE(SUM(total) FILTER (WHERE estado = 'COMPLETADA'), 0)::NUMERIC(12,2) AS total_monto,
            COALESCE(COUNT(*)   FILTER (WHERE estado = 'COMPLETADA'), 0)::BIGINT        AS total_ventas
        FROM ventas
        WHERE negocio_id = v_negocio_id
          AND (p_turno_id IS NULL OR turno_id = p_turno_id)
          AND fecha >= v_inicio_anterior
          AND fecha <  v_fin_anterior
    LOOP
        EXIT;
    END LOOP;

    -- ── Bloque 4: Ganancia período anterior sobre `ventas_detalles` (1 query) ─
    FOR v_detalles_anteriores IN
        SELECT
            COALESCE(SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad), 0)::NUMERIC(12,2) AS ganancia_anterior
        FROM ventas_detalles vd
        JOIN ventas v ON v.id = vd.venta_id
        WHERE v.negocio_id = v_negocio_id
          AND v.estado = 'COMPLETADA'
          AND (p_turno_id IS NULL OR v.turno_id = p_turno_id)
          AND v.fecha >= v_inicio_anterior
          AND v.fecha <  v_fin_anterior
    LOOP
        EXIT;
    END LOOP;

    -- ── Productos sin movimiento (no se vendieron en el período) ──────────────
    v_sin_movimiento := (
        SELECT COUNT(*)
        FROM productos p
        WHERE p.negocio_id = v_negocio_id
          AND p.activo = TRUE
          AND NOT EXISTS (
              SELECT 1
              FROM ventas_detalles vd
              JOIN ventas v ON v.id = vd.venta_id
              WHERE vd.producto_id = p.id
                AND v.estado = 'COMPLETADA'
                AND (p_turno_id IS NULL OR v.turno_id = p_turno_id)
                AND v.fecha >= v_inicio AND v.fecha < v_fin
          )
    );

    -- ── Top 5 productos con menos movimiento (incluye 0 ventas) ──────────────
    v_baja_rotacion := (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
        FROM (
            SELECT p.id                                    AS producto_id,
                   p.nombre                               AS nombre,
                   COALESCE(SUM(vd.cantidad), 0)::INTEGER AS total_unidades,
                   COALESCE(SUM(vd.subtotal), 0)          AS total_monto
            FROM productos p
            LEFT JOIN ventas_detalles vd ON vd.producto_id = p.id
                AND EXISTS (
                    SELECT 1 FROM ventas v
                    WHERE v.id = vd.venta_id
                      AND v.negocio_id = v_negocio_id
                      AND v.estado = 'COMPLETADA'
                      AND (p_turno_id IS NULL OR v.turno_id = p_turno_id)
                      AND v.fecha >= v_inicio AND v.fecha < v_fin
                )
            WHERE p.negocio_id = v_negocio_id
              AND p.activo = TRUE
            GROUP BY p.id, p.nombre
            ORDER BY COALESCE(SUM(vd.cantidad), 0) ASC, p.nombre ASC
            LIMIT 5
        ) t
    );

    -- ── Desglose por método de pago ──────────────────────────────────────────
    v_por_metodo := (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
        FROM (
            SELECT metodo_pago AS metodo, COUNT(*) AS cantidad, SUM(total) AS monto
            FROM   ventas
            WHERE  negocio_id = v_negocio_id AND estado = 'COMPLETADA'
              AND  (p_turno_id IS NULL OR turno_id = p_turno_id)
              AND  fecha >= v_inicio AND fecha < v_fin
            GROUP BY metodo_pago
            ORDER BY SUM(total) DESC
        ) t
    );

    -- ── Desglose por tipo de comprobante ─────────────────────────────────────
    v_por_comprobante := (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
        FROM (
            SELECT tipo_comprobante::TEXT AS tipo, COUNT(*) AS cantidad, SUM(total) AS monto
            FROM   ventas
            WHERE  negocio_id = v_negocio_id AND estado = 'COMPLETADA'
              AND  (p_turno_id IS NULL OR turno_id = p_turno_id)
              AND  fecha >= v_inicio AND fecha < v_fin
            GROUP BY tipo_comprobante
            ORDER BY SUM(total) DESC
        ) t
    );

    -- ── Top 5 productos por ingreso ──────────────────────────────────────────
    v_top_ingreso := (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
        FROM (
            SELECT p.id                  AS producto_id,
                   p.nombre              AS nombre,
                   SUM(vd.cantidad)      AS total_unidades,
                   SUM(vd.subtotal)      AS total_monto,
                   COUNT(DISTINCT v.id)  AS total_ventas
            FROM   ventas_detalles vd
            JOIN   ventas   v ON v.id = vd.venta_id
            JOIN   productos p ON p.id = vd.producto_id
            WHERE  v.negocio_id = v_negocio_id AND v.estado = 'COMPLETADA'
              AND  (p_turno_id IS NULL OR v.turno_id = p_turno_id)
              AND  v.fecha >= v_inicio AND v.fecha < v_fin
            GROUP BY p.id, p.nombre
            ORDER BY SUM(vd.subtotal) DESC
            LIMIT 5
        ) t
    );

    -- ── Top 5 productos por ganancia ─────────────────────────────────────────
    v_top_rentables := (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
        FROM (
            SELECT p.id                                                          AS producto_id,
                   p.nombre                                                      AS nombre,
                   SUM(vd.cantidad)                                              AS total_unidades,
                   SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad)     AS ganancia,
                   CASE WHEN SUM(vd.subtotal) > 0
                        THEN ROUND((SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad) / SUM(vd.subtotal)) * 100, 2)
                        ELSE 0 END                                               AS margen_pct
            FROM   ventas_detalles vd
            JOIN   ventas   v ON v.id = vd.venta_id
            JOIN   productos p ON p.id = vd.producto_id
            WHERE  v.negocio_id = v_negocio_id AND v.estado = 'COMPLETADA'
              AND  (p_turno_id IS NULL OR v.turno_id = p_turno_id)
              AND  v.fecha >= v_inicio AND v.fecha < v_fin
            GROUP BY p.id, p.nombre
            HAVING SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad) > 0
            ORDER BY SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad) DESC
            LIMIT 5
        ) t
    );

    -- ── Ventas por hora (solo si rango es 1 solo día) ────────────────────────
    IF v_dias_rango = 1 THEN
        v_ventas_por_hora := (
            SELECT COALESCE(json_agg(row_to_json(t) ORDER BY hora), '[]'::JSON)
            FROM (
                SELECT EXTRACT(HOUR FROM (v.fecha AT TIME ZONE 'America/Guayaquil'))::INTEGER AS hora,
                       COUNT(*)::INTEGER  AS cantidad,
                       SUM(v.total)       AS monto
                FROM   ventas v
                WHERE  v.negocio_id = v_negocio_id AND v.estado = 'COMPLETADA'
                  AND  (p_turno_id IS NULL OR v.turno_id = p_turno_id)
                  AND  v.fecha >= v_inicio AND v.fecha < v_fin
                GROUP BY hora
            ) t
        );
    ELSE
        v_ventas_por_hora := '[]'::JSON;
    END IF;

    RETURN json_build_object(
        'fecha_inicio',             p_fecha_inicio,
        'fecha_fin',                p_fecha_fin,
        'total_ventas',             v_actuales.total_ventas,
        'total_monto',              v_actuales.total_monto,
        'total_anuladas',           v_actuales.total_anuladas,
        'monto_anulado',            v_actuales.monto_anulado,
        'total_descuentos',         v_actuales.total_descuentos,
        'clientes_unicos',          v_actuales.clientes_unicos,
        'costo_total',              v_detalles_actuales.costo_total,
        'ganancia_bruta',           v_detalles_actuales.ganancia_bruta,
        'margen_pct',               v_margen_pct,
        'ticket_promedio',          v_ticket_promedio,
        'total_monto_anterior',     v_anteriores.total_monto,
        'total_ventas_anterior',    v_anteriores.total_ventas,
        'ganancia_anterior',        v_detalles_anteriores.ganancia_anterior,
        'productos_sin_movimiento', v_sin_movimiento,
        'productos_baja_rotacion',  v_baja_rotacion,
        'por_metodo_pago',          v_por_metodo,
        'por_tipo_comprobante',     v_por_comprobante,
        'top_productos',            v_top_ingreso,
        'top_productos_rentables',  v_top_rentables,
        'ventas_por_hora',          v_ventas_por_hora
    );
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_reporte_ventas_periodo(TEXT, TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_reporte_ventas_periodo(TEXT, TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_reporte_ventas_periodo IS
    'v1.9 — Performance: 6 SELECTs sobre `ventas` consolidados en 1 con COUNT/SUM FILTER, '
    '2 SELECTs sobre `ventas_detalles` consolidados, idem período anterior. '
    'Contrato del JSON sin cambios — todos los campos antiguos se mantienen. '
    'v1.8 — productos_baja_rotacion: top 5 menos vendidos. '
    'v1.7 — Dashboard ejecutivo: ticket promedio, comparativa período anterior, '
    'top productos por ganancia, ventas por hora (rango = 1 día), productos sin movimiento. '
    'Métricas core (totales, métodos de pago, comprobantes, top ingreso) sin cambios.';
