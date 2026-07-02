-- ==========================================
-- fn_grupo_ventas_por_sucursal (v1.0 — 2026-07-01)
-- ==========================================
-- Ranking de sucursales del propietario para el rango dado: una fila por negocio
-- con sus ventas, ganancia, ticket promedio, participación % en el total del
-- grupo, y la comparativa contra el período anterior (para detectar sucursales
-- que están cayendo). Es la métrica de gestión central: responde "qué sucursal
-- me vende más / menos, cuánto aporta cada una, y cuál viene bajando".
--
-- Devuelve TABLE (no JSON) — el frontend la usa directo como lista ordenable.
-- El ORDER BY monto DESC ya entrega el ranking; el frontend resalta la primera
-- (top) y detecta caídas por variacion_pct < 0.
--
-- SEGURIDAD: SECURITY DEFINER, deriva la lista blanca de negocios del propietario
-- del JWT (nunca recibe negocio_id). LEFT JOIN desde la lista de negocios propios
-- para incluir también sucursales SIN ventas en el rango (monto 0) — eso es
-- justamente una señal accionable, no una fila a ocultar.
--
-- No lleva fn_assert_no_superadmin: lectura pura.
-- LANGUAGE plpgsql STABLE.
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_grupo_ventas_por_sucursal(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_grupo_ventas_por_sucursal(
    p_fecha_inicio TEXT,
    p_fecha_fin    TEXT
)
RETURNS TABLE (
    negocio_id            UUID,
    nombre                VARCHAR,
    total_ventas          BIGINT,
    total_monto           NUMERIC(12,2),
    ganancia_bruta        NUMERIC(12,2),
    ticket_promedio       NUMERIC(12,2),
    participacion_pct     NUMERIC(5,2),   -- % del monto total del grupo
    total_monto_anterior  NUMERIC(12,2),
    variacion_pct         NUMERIC(6,2)    -- vs período anterior (+/-); NULL si no había base
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usuario_id      UUID;
    v_negocios        UUID[];
    v_inicio          TIMESTAMPTZ;
    v_fin             TIMESTAMPTZ;
    v_dias_rango      INTEGER;
    v_inicio_anterior TIMESTAMPTZ;
    v_fin_anterior    TIMESTAMPTZ;
    v_total_grupo     NUMERIC(12,2);
BEGIN
    v_usuario_id := (SELECT id FROM usuarios WHERE email = public.get_email());
    v_negocios   := ARRAY(SELECT id FROM negocios WHERE propietario_usuario_id = v_usuario_id);

    IF v_usuario_id IS NULL OR COALESCE(array_length(v_negocios, 1), 0) = 0 THEN
        RETURN;
    END IF;

    v_inicio := (p_fecha_inicio::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    v_fin    := ((p_fecha_fin::DATE + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

    v_dias_rango      := (p_fecha_fin::DATE - p_fecha_inicio::DATE) + 1;
    v_inicio_anterior := ((p_fecha_inicio::DATE - v_dias_rango)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    v_fin_anterior    := (p_fecha_inicio::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

    -- Total del grupo en el período (para calcular participación %)
    -- Alias `v` obligatorio: sin él, `negocio_id` colisiona con la columna de
    -- salida `negocio_id` del RETURNS TABLE ("column reference is ambiguous").
    v_total_grupo := COALESCE((
        SELECT SUM(v.total) FROM ventas v
        WHERE v.negocio_id = ANY(v_negocios)
          AND v.estado = 'COMPLETADA'
          AND v.fecha >= v_inicio AND v.fecha < v_fin
    ), 0);

    RETURN QUERY
    WITH negocios_grupo AS (
        SELECT n.id, n.nombre
        FROM negocios n
        WHERE n.id = ANY(v_negocios)
    ),
    -- Ventas del período actual por negocio
    actual AS (
        SELECT v.negocio_id,
               COUNT(*)::BIGINT                  AS ventas,
               COALESCE(SUM(v.total), 0)::NUMERIC(12,2) AS monto
        FROM ventas v
        WHERE v.negocio_id = ANY(v_negocios)
          AND v.estado = 'COMPLETADA'
          AND v.fecha >= v_inicio AND v.fecha < v_fin
        GROUP BY v.negocio_id
    ),
    -- Ganancia del período actual por negocio
    ganancia AS (
        SELECT v.negocio_id,
               COALESCE(SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad), 0)::NUMERIC(12,2) AS ganancia
        FROM ventas_detalles vd
        JOIN ventas v ON v.id = vd.venta_id
        WHERE v.negocio_id = ANY(v_negocios)
          AND v.estado = 'COMPLETADA'
          AND v.fecha >= v_inicio AND v.fecha < v_fin
        GROUP BY v.negocio_id
    ),
    -- Monto del período anterior por negocio (para la variación)
    anterior AS (
        SELECT v.negocio_id,
               COALESCE(SUM(v.total), 0)::NUMERIC(12,2) AS monto
        FROM ventas v
        WHERE v.negocio_id = ANY(v_negocios)
          AND v.estado = 'COMPLETADA'
          AND v.fecha >= v_inicio_anterior AND v.fecha < v_fin_anterior
        GROUP BY v.negocio_id
    )
    SELECT
        ng.id,
        ng.nombre,
        COALESCE(a.ventas, 0)::BIGINT,
        COALESCE(a.monto, 0)::NUMERIC(12,2),
        COALESCE(g.ganancia, 0)::NUMERIC(12,2),
        CASE WHEN COALESCE(a.ventas, 0) > 0
             THEN ROUND(COALESCE(a.monto, 0) / a.ventas, 2)
             ELSE 0 END::NUMERIC(12,2)                                   AS ticket_promedio,
        CASE WHEN v_total_grupo > 0
             THEN ROUND((COALESCE(a.monto, 0) / v_total_grupo) * 100, 2)
             ELSE 0 END::NUMERIC(5,2)                                    AS participacion_pct,
        COALESCE(ant.monto, 0)::NUMERIC(12,2)                           AS total_monto_anterior,
        CASE WHEN COALESCE(ant.monto, 0) > 0
             THEN ROUND(((COALESCE(a.monto, 0) - ant.monto) / ant.monto) * 100, 2)
             ELSE NULL END::NUMERIC(6,2)                                 AS variacion_pct
    FROM negocios_grupo ng
    LEFT JOIN actual   a   ON a.negocio_id   = ng.id
    LEFT JOIN ganancia g   ON g.negocio_id   = ng.id
    LEFT JOIN anterior ant ON ant.negocio_id = ng.id
    ORDER BY COALESCE(a.monto, 0) DESC, ng.nombre ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_grupo_ventas_por_sucursal(TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_grupo_ventas_por_sucursal(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_grupo_ventas_por_sucursal IS
'v1.0 — Ranking de sucursales del propietario: ventas, ganancia, ticket, % de
participación y variación vs período anterior. Incluye sucursales sin ventas
(señal accionable). SECURITY DEFINER: lista de negocios derivada del JWT.';
