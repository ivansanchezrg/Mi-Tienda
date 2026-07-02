-- ==========================================
-- fn_grupo_resumen_ventas (v1.0 — 2026-07-01)
-- ==========================================
-- Totales de ventas CONSOLIDADOS de todos los negocios de los que el usuario
-- autenticado es propietario, para el rango [p_fecha_inicio, p_fecha_fin],
-- más la comparativa contra el período inmediatamente anterior (misma cantidad
-- de días, retrocedido) — para el dashboard ejecutivo del grupo.
--
-- Espeja el contrato de métricas de fn_reporte_ventas_periodo (mismos nombres
-- de campo) pero agregando sobre la LISTA de negocios del propietario en lugar
-- de un solo negocio_id del JWT.
--
-- SEGURIDAD (crítico): SECURITY DEFINER bypassa RLS. La función NO recibe
-- negocio_id del cliente — deriva la lista blanca de negocios internamente vía
-- propietario_usuario_id = <usuario del JWT>. Si el usuario no es propietario de
-- ningún negocio, todas las agregaciones dan 0 (lista vacía). Un usuario nunca
-- puede consolidar negocios ajenos.
--
-- No lleva fn_assert_no_superadmin: lectura pura.
--
-- LANGUAGE plpgsql STABLE: lectura pura.
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_grupo_resumen_ventas(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_grupo_resumen_ventas(
    p_fecha_inicio TEXT,
    p_fecha_fin    TEXT
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usuario_id       UUID;
    v_negocios         UUID[];          -- lista blanca de negocios del propietario
    v_inicio           TIMESTAMPTZ;
    v_fin              TIMESTAMPTZ;
    v_dias_rango       INTEGER;
    v_inicio_anterior  TIMESTAMPTZ;
    v_fin_anterior     TIMESTAMPTZ;

    v_actuales           RECORD;   -- COUNTs/SUMs período actual sobre ventas
    v_detalles_actuales  RECORD;   -- costo + ganancia actual sobre ventas_detalles
    v_anteriores         RECORD;   -- período anterior sobre ventas
    v_detalles_anteriores RECORD;  -- ganancia anterior sobre ventas_detalles

    v_margen_pct         NUMERIC(5,2);
    v_ticket_promedio    NUMERIC(12,2);
BEGIN
    -- ── Resolver propietario + lista blanca de negocios (nunca desde parámetro) ──
    v_usuario_id := (SELECT id FROM usuarios WHERE email = public.get_email());

    v_negocios := ARRAY(
        SELECT id FROM negocios WHERE propietario_usuario_id = v_usuario_id
    );

    -- Sin negocios propios → shape de ceros (el frontend no debería llamar aquí,
    -- pero es defensa en profundidad).
    IF v_usuario_id IS NULL OR COALESCE(array_length(v_negocios, 1), 0) = 0 THEN
        RETURN json_build_object(
            'fecha_inicio', p_fecha_inicio,
            'fecha_fin', p_fecha_fin,
            'total_negocios', 0,
            'total_ventas', 0, 'total_monto', 0,
            'total_anuladas', 0, 'monto_anulado', 0,
            'total_descuentos', 0, 'clientes_unicos', 0,
            'costo_total', 0, 'ganancia_bruta', 0,
            'margen_pct', 0, 'ticket_promedio', 0,
            'total_monto_anterior', 0, 'total_ventas_anterior', 0,
            'ganancia_anterior', 0
        );
    END IF;

    -- ── Rangos (exclusivo al final; período anterior = mismos días retrocedidos) ──
    v_inicio := (p_fecha_inicio::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    v_fin    := ((p_fecha_fin::DATE + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

    v_dias_rango := (p_fecha_fin::DATE - p_fecha_inicio::DATE) + 1;
    v_inicio_anterior := ((p_fecha_inicio::DATE - v_dias_rango)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    v_fin_anterior    := (p_fecha_inicio::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

    -- ── Bloque 1: agregados período actual sobre `ventas` (1 query) ──────────
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
        WHERE negocio_id = ANY(v_negocios)
          AND fecha >= v_inicio
          AND fecha <  v_fin
    LOOP EXIT; END LOOP;

    -- ── Bloque 2: costo + ganancia actual sobre `ventas_detalles` (1 query) ──
    FOR v_detalles_actuales IN
        SELECT
            COALESCE(SUM(vd.precio_costo * vd.cantidad), 0)::NUMERIC(12,2)                        AS costo_total,
            COALESCE(SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad), 0)::NUMERIC(12,2) AS ganancia_bruta
        FROM ventas_detalles vd
        JOIN ventas v ON v.id = vd.venta_id
        WHERE v.negocio_id = ANY(v_negocios)
          AND v.estado = 'COMPLETADA'
          AND v.fecha >= v_inicio AND v.fecha < v_fin
    LOOP EXIT; END LOOP;

    v_margen_pct      := CASE WHEN v_actuales.total_monto > 0
                              THEN ROUND((v_detalles_actuales.ganancia_bruta / v_actuales.total_monto) * 100, 2)
                              ELSE 0 END;
    v_ticket_promedio := CASE WHEN v_actuales.total_ventas > 0
                              THEN ROUND(v_actuales.total_monto / v_actuales.total_ventas, 2)
                              ELSE 0 END;

    -- ── Bloque 3: agregados período anterior sobre `ventas` (1 query) ─────────
    FOR v_anteriores IN
        SELECT
            COALESCE(SUM(total) FILTER (WHERE estado = 'COMPLETADA'), 0)::NUMERIC(12,2) AS total_monto,
            COALESCE(COUNT(*)   FILTER (WHERE estado = 'COMPLETADA'), 0)::BIGINT        AS total_ventas
        FROM ventas
        WHERE negocio_id = ANY(v_negocios)
          AND fecha >= v_inicio_anterior
          AND fecha <  v_fin_anterior
    LOOP EXIT; END LOOP;

    -- ── Bloque 4: ganancia período anterior sobre `ventas_detalles` (1 query) ─
    FOR v_detalles_anteriores IN
        SELECT
            COALESCE(SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad), 0)::NUMERIC(12,2) AS ganancia_anterior
        FROM ventas_detalles vd
        JOIN ventas v ON v.id = vd.venta_id
        WHERE v.negocio_id = ANY(v_negocios)
          AND v.estado = 'COMPLETADA'
          AND v.fecha >= v_inicio_anterior AND v.fecha < v_fin_anterior
    LOOP EXIT; END LOOP;

    RETURN json_build_object(
        'fecha_inicio',             p_fecha_inicio,
        'fecha_fin',                p_fecha_fin,
        'total_negocios',           array_length(v_negocios, 1),
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
        'ganancia_anterior',        v_detalles_anteriores.ganancia_anterior
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_grupo_resumen_ventas(TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_grupo_resumen_ventas(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_grupo_resumen_ventas IS
'v1.0 — Totales de ventas consolidados de todos los negocios del propietario
autenticado + comparativa período anterior. SECURITY DEFINER: deriva la lista
de negocios de propietario_usuario_id del JWT, nunca recibe negocio_id.';
