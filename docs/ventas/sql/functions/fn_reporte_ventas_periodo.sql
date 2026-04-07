-- ==========================================
-- DROP — firmas anteriores
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_reporte_ventas_periodo(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_reporte_ventas_periodo(TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.fn_reporte_ventas_periodo(TEXT, TEXT, UUID, INTEGER);

-- ==========================================
-- FUNCIÓN: fn_reporte_ventas_periodo (v1.4)
-- ==========================================
-- Genera un resumen de ventas para un rango de fechas.
-- Incluye totales generales, desglose por método de pago,
-- por tipo de comprobante, top 5 productos más vendidos
-- y ganancia bruta del período (precio_venta - precio_costo).
-- Las ventas anuladas se reportan aparte (total_anuladas, monto_anulado).
-- Todos los roles ven todas las ventas. El filtro de turno es solo para ADMIN.
--
-- v1.4 — Usa vd.precio_costo (snapshot histórico en ventas_detalles) en lugar de
--   p.precio_costo (precio actual del producto). Los reportes históricos ya no
--   cambian si se modifica el costo de un producto.
-- v1.3 — Simplificado: todos los roles ven todas las ventas. Se elimina p_empleado_id.
-- v1.2 — Agrega: p_turno_id para filtrar ventas de un turno específico.
-- v1.1 — Agrega: costo_total, ganancia_bruta, margen_pct
--
-- Todas las fechas se calculan en zona horaria Ecuador (America/Guayaquil).
-- Usa rango exclusivo [inicio, fin) — patrón obligatorio del proyecto.
--
-- Llamada desde: VentasService.obtenerReportePeriodo(filtro, turnoId?)
-- Parámetros:
--   p_fecha_inicio — Fecha inicio en formato 'YYYY-MM-DD'
--   p_fecha_fin    — Fecha fin en formato 'YYYY-MM-DD' (exclusivo: se suma 1 día internamente)
--   p_turno_id     — UUID del turno. NULL = todos los turnos del período
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
    v_inicio          TIMESTAMPTZ;
    v_fin             TIMESTAMPTZ;
    v_total_ventas    BIGINT;
    v_total_monto     NUMERIC(12,2);
    v_total_anuladas  BIGINT;
    v_monto_anulado   NUMERIC(12,2);
    v_costo_total     NUMERIC(12,2);
    v_ganancia_bruta  NUMERIC(12,2);
    v_margen_pct      NUMERIC(5,2);
    v_por_metodo      JSON;
    v_por_comprobante JSON;
    v_top_productos   JSON;
BEGIN
    -- ── Rango en zona Ecuador (exclusivo al final) ──
    v_inicio := (p_fecha_inicio::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    v_fin    := ((p_fecha_fin::DATE + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

    -- ── Totales de ventas completadas ──
    SELECT COALESCE(COUNT(*), 0),
           COALESCE(SUM(total), 0)
    INTO   v_total_ventas, v_total_monto
    FROM   ventas
    WHERE  estado = 'COMPLETADA'
      AND  (p_turno_id IS NULL OR turno_id = p_turno_id)
      AND  fecha >= v_inicio
      AND  fecha <  v_fin;

    -- ── Totales de ventas anuladas ──
    SELECT COALESCE(COUNT(*), 0),
           COALESCE(SUM(total), 0)
    INTO   v_total_anuladas, v_monto_anulado
    FROM   ventas
    WHERE  estado = 'ANULADA'
      AND  (p_turno_id IS NULL OR turno_id = p_turno_id)
      AND  fecha >= v_inicio
      AND  fecha <  v_fin;

    -- ── Ganancia bruta: (precio_venta - precio_costo) * unidades ──
    -- precio_costo es el snapshot guardado al momento de la venta → históricamente exacto
    SELECT COALESCE(SUM(vd.precio_costo * vd.cantidad), 0),
           COALESCE(SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad), 0)
    INTO   v_costo_total, v_ganancia_bruta
    FROM   ventas_detalles vd
    JOIN   ventas v ON v.id = vd.venta_id
    WHERE  v.estado = 'COMPLETADA'
      AND  (p_turno_id IS NULL OR v.turno_id = p_turno_id)
      AND  v.fecha  >= v_inicio
      AND  v.fecha  <  v_fin;

    -- ── Margen % (0 si no hay ventas) ──
    v_margen_pct := CASE
        WHEN v_total_monto > 0
        THEN ROUND((v_ganancia_bruta / v_total_monto) * 100, 2)
        ELSE 0
    END;

    -- ── Desglose por método de pago (solo completadas) ──
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
    INTO   v_por_metodo
    FROM (
        SELECT metodo_pago AS metodo,
               COUNT(*)    AS cantidad,
               SUM(total)  AS monto
        FROM   ventas
        WHERE  estado = 'COMPLETADA'
          AND  (p_turno_id IS NULL OR turno_id = p_turno_id)
          AND  fecha >= v_inicio
          AND  fecha <  v_fin
        GROUP BY metodo_pago
        ORDER BY SUM(total) DESC
    ) t;

    -- ── Desglose por tipo de comprobante (solo completadas) ──
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
    INTO   v_por_comprobante
    FROM (
        SELECT tipo_comprobante::TEXT AS tipo,
               COUNT(*)              AS cantidad,
               SUM(total)            AS monto
        FROM   ventas
        WHERE  estado = 'COMPLETADA'
          AND  (p_turno_id IS NULL OR turno_id = p_turno_id)
          AND  fecha >= v_inicio
          AND  fecha <  v_fin
        GROUP BY tipo_comprobante
        ORDER BY SUM(total) DESC
    ) t;

    -- ── Top 5 productos más vendidos (solo ventas completadas) ──
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
    INTO   v_top_productos
    FROM (
        SELECT p.id               AS producto_id,
               p.nombre           AS nombre,
               SUM(vd.cantidad)   AS total_unidades,
               SUM(vd.subtotal)   AS total_monto,
               COUNT(DISTINCT v.id) AS total_ventas
        FROM   ventas_detalles vd
        JOIN   ventas   v ON v.id = vd.venta_id
        JOIN   productos p ON p.id = vd.producto_id
        WHERE  v.estado = 'COMPLETADA'
          AND  (p_turno_id IS NULL OR v.turno_id = p_turno_id)
          AND  v.fecha  >= v_inicio
          AND  v.fecha  <  v_fin
        GROUP BY p.id, p.nombre
        ORDER BY SUM(vd.cantidad) DESC
        LIMIT 5
    ) t;

    -- ── Resultado ──
    RETURN json_build_object(
        'fecha_inicio',         p_fecha_inicio,
        'fecha_fin',            p_fecha_fin,
        'total_ventas',         v_total_ventas,
        'total_monto',          v_total_monto,
        'total_anuladas',       v_total_anuladas,
        'monto_anulado',        v_monto_anulado,
        'costo_total',          v_costo_total,
        'ganancia_bruta',       v_ganancia_bruta,
        'margen_pct',           v_margen_pct,
        'por_metodo_pago',      v_por_metodo,
        'por_tipo_comprobante', v_por_comprobante,
        'top_productos',        v_top_productos
    );
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_reporte_ventas_periodo(TEXT, TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_reporte_ventas_periodo(TEXT, TEXT, UUID) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_reporte_ventas_periodo IS
    'v1.4 — Usa vd.precio_costo (snapshot histórico) para cálculo de ganancia bruta. '
    'v1.3 — Resumen de ventas de un período: totales, ganancia bruta, margen %, '
    'desglose por método de pago, tipo de comprobante y top 5 productos más vendidos '
    '(solo COMPLETADAS). Filtro opcional por turno (solo ADMIN lo usa desde el frontend). '
    'Todos los roles ven todas las ventas. Fechas en zona Ecuador (America/Guayaquil).';
