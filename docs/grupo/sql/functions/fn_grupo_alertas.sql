-- ==========================================
-- fn_grupo_alertas (v1.0 — 2026-07-02)
-- ==========================================
-- Alertas accionables por negocio para el dashboard "Resumen general". Devuelve
-- un array plano de alertas (0..N por negocio) que el frontend renderiza como
-- lista. Tres tipos:
--
--   • SIN_VENTAS   → el negocio no vendió nada en el período (monto = 0).
--   • CAYENDO      → variación ≤ −25% vs el período anterior (mismos días
--                    retrocedidos). Solo si HABÍA base anterior (> 0), para no
--                    marcar como "caída" a un negocio que simplemente es nuevo.
--   • STOCK_BAJO   → conteo de productos activos con stock_actual < stock_minimo.
--                    SNAPSHOT actual (no depende del período) — es un estado del
--                    inventario hoy, no del rango de ventas.
--
-- Forma de cada alerta:
--   { "tipo": "CAYENDO", "negocio_id": "...", "nombre": "Tienda A",
--     "valor": -32.10 }   -- % de caída (CAYENDO) | # de productos (STOCK_BAJO)
--                          -- | 0 (SIN_VENTAS)
--
-- SEGURIDAD: SECURITY DEFINER, lista blanca de negocios derivada del JWT
-- (propietario_usuario_id). Nunca recibe negocio_id. Lectura pura, sin
-- fn_assert_no_superadmin.
--
-- ÍNDICE / ZONA HORARIA: el WHERE de ventas acota `fecha` por rango UTC en
-- variables (v_inicio/v_fin) — conserva el índice (negocio_id, fecha).
--
-- LANGUAGE plpgsql STABLE.
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_grupo_alertas(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_grupo_alertas(
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
    v_usuario_id      UUID;
    v_negocios        UUID[];
    v_inicio          TIMESTAMPTZ;
    v_fin             TIMESTAMPTZ;
    v_dias_rango      INTEGER;
    v_inicio_anterior TIMESTAMPTZ;
    v_fin_anterior    TIMESTAMPTZ;
    v_alertas         JSON;
BEGIN
    v_usuario_id := (SELECT id FROM usuarios WHERE email = public.get_email());
    v_negocios   := ARRAY(SELECT id FROM negocios WHERE propietario_usuario_id = v_usuario_id);

    IF v_usuario_id IS NULL OR COALESCE(array_length(v_negocios, 1), 0) = 0 THEN
        RETURN '[]'::JSON;
    END IF;

    v_inicio := (p_fecha_inicio::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    v_fin    := ((p_fecha_fin::DATE + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

    v_dias_rango      := (p_fecha_fin::DATE - p_fecha_inicio::DATE) + 1;
    v_inicio_anterior := ((p_fecha_inicio::DATE - v_dias_rango)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    v_fin_anterior    := (p_fecha_inicio::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

    v_alertas := (
        SELECT COALESCE(json_agg(row_to_json(al) ORDER BY al.orden, al.nombre), '[]'::JSON)
        FROM (
            WITH negocios_grupo AS (
                SELECT n.id, n.nombre
                FROM negocios n
                WHERE n.id = ANY(v_negocios)
            ),
            actual AS (
                SELECT v.negocio_id, COALESCE(SUM(v.total), 0)::NUMERIC(12,2) AS monto
                FROM ventas v
                WHERE v.negocio_id = ANY(v_negocios)
                  AND v.estado = 'COMPLETADA'
                  AND v.fecha >= v_inicio AND v.fecha < v_fin
                GROUP BY v.negocio_id
            ),
            anterior AS (
                SELECT v.negocio_id, COALESCE(SUM(v.total), 0)::NUMERIC(12,2) AS monto
                FROM ventas v
                WHERE v.negocio_id = ANY(v_negocios)
                  AND v.estado = 'COMPLETADA'
                  AND v.fecha >= v_inicio_anterior AND v.fecha < v_fin_anterior
                GROUP BY v.negocio_id
            ),
            -- Stock bajo: snapshot actual de productos activos por negocio.
            stock AS (
                SELECT p.negocio_id, COUNT(*)::INTEGER AS bajos
                FROM productos p
                WHERE p.negocio_id = ANY(v_negocios)
                  AND p.activo = TRUE
                  AND p.stock_actual < p.stock_minimo
                GROUP BY p.negocio_id
            ),
            base AS (
                SELECT
                    ng.id                       AS negocio_id,
                    ng.nombre                   AS nombre,
                    COALESCE(a.monto, 0)        AS monto_actual,
                    COALESCE(ant.monto, 0)      AS monto_anterior,
                    COALESCE(s.bajos, 0)        AS stock_bajo
                FROM negocios_grupo ng
                LEFT JOIN actual   a   ON a.negocio_id   = ng.id
                LEFT JOIN anterior ant ON ant.negocio_id = ng.id
                LEFT JOIN stock    s   ON s.negocio_id   = ng.id
            )
            -- SIN_VENTAS
            SELECT 1 AS orden, 'SIN_VENTAS' AS tipo, b.negocio_id, b.nombre, 0::NUMERIC(6,2) AS valor
            FROM base b
            WHERE b.monto_actual = 0

            UNION ALL

            -- CAYENDO (≤ −25%, con base anterior > 0 y algo de venta actual)
            SELECT 2 AS orden, 'CAYENDO' AS tipo, b.negocio_id, b.nombre,
                   ROUND(((b.monto_actual - b.monto_anterior) / b.monto_anterior) * 100, 2) AS valor
            FROM base b
            WHERE b.monto_anterior > 0
              AND b.monto_actual > 0
              AND ((b.monto_actual - b.monto_anterior) / b.monto_anterior) * 100 <= -25

            UNION ALL

            -- STOCK_BAJO (snapshot; N productos bajo el mínimo)
            SELECT 3 AS orden, 'STOCK_BAJO' AS tipo, b.negocio_id, b.nombre, b.stock_bajo::NUMERIC(6,2) AS valor
            FROM base b
            WHERE b.stock_bajo > 0
        ) al
    );

    RETURN v_alertas;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_grupo_alertas(TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_grupo_alertas(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_grupo_alertas IS
'v1.0 — Alertas accionables por negocio del grupo: SIN_VENTAS, CAYENDO (≤ −25% vs
período anterior con base previa), STOCK_BAJO (# productos activos bajo el mínimo,
snapshot). SECURITY DEFINER: lista de negocios derivada del JWT.';
