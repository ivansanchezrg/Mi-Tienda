-- ==========================================
-- fn_grupo_top_productos (v1.0 — 2026-07-01)
-- ==========================================
-- Top productos del GRUPO (todos los negocios del propietario) en el rango:
--   • top_ingreso   → 5 productos que más facturaron
--   • top_rentables → 5 productos que más ganancia dejaron
--
-- IMPORTANTE — agrupación por NOMBRE, no por producto_id:
--   Cada negocio tiene su propio catálogo (productos.negocio_id). El mismo
--   producto conceptual ("Coca-Cola 500ml") es una fila distinta en cada
--   sucursal. Para un top consolidado con sentido de negocio, se agrupa por
--   `nombre` (normalizado con TRIM+LOWER) para sumar las ventas del mismo
--   producto a través de las sucursales. El nombre visible se toma con MAX()
--   (cualquiera de las variantes; en la práctica son idénticos).
--
-- SEGURIDAD: SECURITY DEFINER, lista blanca de negocios derivada del JWT
-- (propietario_usuario_id). Nunca recibe negocio_id. No lleva
-- fn_assert_no_superadmin: lectura pura.
-- LANGUAGE plpgsql STABLE.
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_grupo_top_productos(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_grupo_top_productos(
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
    v_usuario_id  UUID;
    v_negocios    UUID[];
    v_inicio      TIMESTAMPTZ;
    v_fin         TIMESTAMPTZ;
    v_top_ingreso   JSON;
    v_top_rentables JSON;
BEGIN
    v_usuario_id := (SELECT id FROM usuarios WHERE email = public.get_email());
    v_negocios   := ARRAY(SELECT id FROM negocios WHERE propietario_usuario_id = v_usuario_id);

    IF v_usuario_id IS NULL OR COALESCE(array_length(v_negocios, 1), 0) = 0 THEN
        RETURN json_build_object('top_ingreso', '[]'::JSON, 'top_rentables', '[]'::JSON);
    END IF;

    v_inicio := (p_fecha_inicio::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    v_fin    := ((p_fecha_fin::DATE + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

    -- ── Top 5 por ingreso (agrupado por nombre a través de sucursales) ────────
    v_top_ingreso := (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
        FROM (
            SELECT LOWER(TRIM(p.nombre))       AS clave,
                   MAX(p.nombre)               AS nombre,
                   SUM(vd.cantidad)::NUMERIC(12,2) AS total_unidades,
                   SUM(vd.subtotal)::NUMERIC(12,2) AS total_monto,
                   COUNT(DISTINCT p.negocio_id)::INTEGER AS sucursales
            FROM ventas_detalles vd
            JOIN ventas   v ON v.id = vd.venta_id
            JOIN productos p ON p.id = vd.producto_id
            WHERE v.negocio_id = ANY(v_negocios)
              AND v.estado = 'COMPLETADA'
              AND v.fecha >= v_inicio AND v.fecha < v_fin
            GROUP BY LOWER(TRIM(p.nombre))
            ORDER BY SUM(vd.subtotal) DESC
            LIMIT 5
        ) t
    );

    -- ── Top 5 por ganancia ────────────────────────────────────────────────────
    v_top_rentables := (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
        FROM (
            SELECT LOWER(TRIM(p.nombre))       AS clave,
                   MAX(p.nombre)               AS nombre,
                   SUM(vd.cantidad)::NUMERIC(12,2) AS total_unidades,
                   SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad)::NUMERIC(12,2) AS ganancia,
                   CASE WHEN SUM(vd.subtotal) > 0
                        THEN ROUND((SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad) / SUM(vd.subtotal)) * 100, 2)
                        ELSE 0 END                AS margen_pct,
                   COUNT(DISTINCT p.negocio_id)::INTEGER AS sucursales
            FROM ventas_detalles vd
            JOIN ventas   v ON v.id = vd.venta_id
            JOIN productos p ON p.id = vd.producto_id
            WHERE v.negocio_id = ANY(v_negocios)
              AND v.estado = 'COMPLETADA'
              AND v.fecha >= v_inicio AND v.fecha < v_fin
            GROUP BY LOWER(TRIM(p.nombre))
            HAVING SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad) > 0
            ORDER BY SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad) DESC
            LIMIT 5
        ) t
    );

    RETURN json_build_object(
        'top_ingreso',   v_top_ingreso,
        'top_rentables', v_top_rentables
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_grupo_top_productos(TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_grupo_top_productos(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_grupo_top_productos IS
'v1.0 — Top productos del grupo (por ingreso y por ganancia), agrupados por
nombre a través de las sucursales del propietario. SECURITY DEFINER: lista de
negocios derivada del JWT.';
