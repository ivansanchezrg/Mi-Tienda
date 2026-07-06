-- ==========================================
-- fn_grupo_ventas_series (v1.0 — 2026-07-02)
-- ==========================================
-- Serie temporal para el GRÁFICO DE LÍNEAS del dashboard "Resumen general":
-- por cada día del rango [p_fecha_inicio, p_fecha_fin] y cada negocio del
-- propietario, el monto vendido (ventas COMPLETADAS). Una línea por sucursal.
--
-- Contrato de salida (JSON), listo para ng-apexcharts (multi-línea):
--   {
--     "dias":   ["2026-07-01", "2026-07-02", ...],        -- eje X (fechas locales)
--     "series": [
--        { "negocio_id": "...", "nombre": "Tienda A", "valores": [12.5, 0, 40, ...] },
--        { "negocio_id": "...", "nombre": "Tienda B", "valores": [ 0,  9, 15, ...] }
--     ]
--   }
-- Cada `valores[i]` corresponde a `dias[i]` (alineado por posición). El frontend
-- usa `dias` como categorías del eje X y cada serie como una línea.
--
-- SIN HUECOS: se usa generate_series para producir TODOS los días del rango,
-- incluidos los de $0 — así la línea no se interrumpe. Patrón nuevo en el
-- proyecto (no existía). El LEFT JOIN desde la grilla (negocio × día) hacia las
-- ventas garantiza una fila por cada combinación, con 0 donde no hubo venta.
--
-- ZONA HORARIA + ÍNDICE: el WHERE acota `fecha` por rango UTC en variables
-- (v_inicio/v_fin como TIMESTAMPTZ) para conservar el índice (negocio_id, fecha).
-- El agrupado por día se hace convirtiendo `fecha` a fecha local Ecuador DENTRO
-- del SELECT/GROUP BY — nunca en el WHERE. Misma regla que el resto del proyecto
-- (CLAUDE.md: no usar (fecha AT TIME ZONE ...)::date en cláusulas WHERE).
--
-- SEGURIDAD: SECURITY DEFINER, deriva la lista blanca de negocios del propietario
-- del JWT (propietario_usuario_id). Nunca recibe negocio_id. Lectura pura, sin
-- fn_assert_no_superadmin.
--
-- LANGUAGE plpgsql STABLE.
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_grupo_ventas_series(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_grupo_ventas_series(
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
    v_usuario_id UUID;
    v_negocios   UUID[];
    v_inicio     TIMESTAMPTZ;
    v_fin        TIMESTAMPTZ;
    v_dias       JSON;
    v_series     JSON;
BEGIN
    v_usuario_id := (SELECT id FROM usuarios WHERE email = public.get_email());
    v_negocios   := ARRAY(SELECT id FROM negocios WHERE propietario_usuario_id = v_usuario_id);

    IF v_usuario_id IS NULL OR COALESCE(array_length(v_negocios, 1), 0) = 0 THEN
        RETURN json_build_object('dias', '[]'::JSON, 'series', '[]'::JSON);
    END IF;

    -- Rango UTC para el WHERE (conserva el índice), fin exclusivo.
    v_inicio := (p_fecha_inicio::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    v_fin    := ((p_fecha_fin::DATE + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

    -- Eje X: todos los días locales del rango, en orden.
    v_dias := (
        SELECT COALESCE(json_agg(to_char(d, 'YYYY-MM-DD') ORDER BY d), '[]'::JSON)
        FROM generate_series(p_fecha_inicio::DATE, p_fecha_fin::DATE, INTERVAL '1 day') AS d
    );

    -- Una serie por negocio: grilla (negocio × día) LEFT JOIN ventas del día.
    -- El agrupado por día usa la fecha local (AT TIME ZONE) dentro del JOIN, no
    -- en el WHERE — el WHERE ya acotó el rango con v_inicio/v_fin (UTC, indexado).
    v_series := (
        SELECT COALESCE(json_agg(row_to_json(s) ORDER BY s.total_rango DESC, s.nombre ASC), '[]'::JSON)
        FROM (
            SELECT
                ng.id     AS negocio_id,
                ng.nombre AS nombre,
                COALESCE(SUM(vd.monto_dia), 0)::NUMERIC(12,2) AS total_rango,  -- solo para ordenar las líneas
                json_agg(
                    COALESCE(vd.monto_dia, 0)::NUMERIC(12,2)
                    ORDER BY g.dia
                ) AS valores
            FROM negocios ng
            -- grilla completa de días por negocio (sin huecos)
            CROSS JOIN generate_series(p_fecha_inicio::DATE, p_fecha_fin::DATE, INTERVAL '1 day') AS g(dia)
            -- ventas agregadas por (negocio, día local)
            LEFT JOIN (
                SELECT v.negocio_id,
                       (v.fecha AT TIME ZONE 'America/Guayaquil')::DATE AS dia,
                       SUM(v.total)::NUMERIC(12,2)                       AS monto_dia
                FROM ventas v
                WHERE v.negocio_id = ANY(v_negocios)
                  AND v.estado = 'COMPLETADA'
                  AND v.fecha >= v_inicio AND v.fecha < v_fin
                GROUP BY v.negocio_id, (v.fecha AT TIME ZONE 'America/Guayaquil')::DATE
            ) vd ON vd.negocio_id = ng.id AND vd.dia = g.dia::DATE
            WHERE ng.id = ANY(v_negocios)
            GROUP BY ng.id, ng.nombre
        ) s
    );

    RETURN json_build_object('dias', v_dias, 'series', v_series);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_grupo_ventas_series(TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_grupo_ventas_series(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_grupo_ventas_series IS
'v1.0 — Serie temporal día×negocio (monto vendido) para el gráfico de líneas del
dashboard del grupo. generate_series produce todos los días del rango (sin huecos,
$0 incluido). SECURITY DEFINER: lista de negocios derivada del JWT. Agrupa por
fecha local Ecuador dentro del SELECT; el WHERE usa rango UTC para no perder el
índice.';
