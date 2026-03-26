-- ==========================================
-- FUNCIÓN: reporte_ventas_dia (v1.0)
-- ==========================================
-- Genera un resumen de ventas para una fecha específica.
-- Incluye totales generales, desglose por método de pago y por tipo de comprobante.
-- Las ventas anuladas se reportan aparte (total_anuladas, monto_anulado).
--
-- Todas las fechas se calculan en zona horaria Ecuador (America/Guayaquil).
-- Usa rango exclusivo [inicio, fin) — patrón obligatorio del proyecto.
--
-- Llamada desde: ReportesService.obtenerReporteDia()
-- Parámetros:
--   p_fecha — Fecha en formato 'YYYY-MM-DD'
-- ==========================================

CREATE OR REPLACE FUNCTION public.reporte_ventas_dia(
    p_fecha TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_fecha_local    DATE;
    v_inicio         TIMESTAMPTZ;
    v_fin            TIMESTAMPTZ;
    v_total_ventas   BIGINT;
    v_total_monto    NUMERIC(12,2);
    v_total_anuladas BIGINT;
    v_monto_anulado  NUMERIC(12,2);
    v_por_metodo     JSON;
    v_por_comprobante JSON;
BEGIN
    -- ── Fecha: si no se pasa, usar hoy en Ecuador ──
    IF p_fecha IS NULL OR TRIM(p_fecha) = '' THEN
        v_fecha_local := (NOW() AT TIME ZONE 'America/Guayaquil')::DATE;
    ELSE
        v_fecha_local := p_fecha::DATE;
    END IF;

    -- ── Rango del día en zona Ecuador (exclusivo) ──
    v_inicio := (v_fecha_local::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    v_fin    := ((v_fecha_local + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

    -- ── Totales de ventas completadas ──
    SELECT COALESCE(COUNT(*), 0),
           COALESCE(SUM(total), 0)
    INTO   v_total_ventas, v_total_monto
    FROM   ventas
    WHERE  estado = 'COMPLETADA'
      AND  fecha >= v_inicio
      AND  fecha <  v_fin;

    -- ── Totales de ventas anuladas ──
    SELECT COALESCE(COUNT(*), 0),
           COALESCE(SUM(total), 0)
    INTO   v_total_anuladas, v_monto_anulado
    FROM   ventas
    WHERE  estado = 'ANULADA'
      AND  fecha >= v_inicio
      AND  fecha <  v_fin;

    -- ── Desglose por método de pago (solo completadas) ──
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::JSON)
    INTO   v_por_metodo
    FROM (
        SELECT metodo_pago AS metodo,
               COUNT(*)    AS cantidad,
               SUM(total)  AS monto
        FROM   ventas
        WHERE  estado = 'COMPLETADA'
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
          AND  fecha >= v_inicio
          AND  fecha <  v_fin
        GROUP BY tipo_comprobante
        ORDER BY SUM(total) DESC
    ) t;

    -- ── Resultado ──
    RETURN json_build_object(
        'fecha',              v_fecha_local::TEXT,
        'total_ventas',       v_total_ventas,
        'total_monto',        v_total_monto,
        'total_anuladas',     v_total_anuladas,
        'monto_anulado',      v_monto_anulado,
        'por_metodo_pago',    v_por_metodo,
        'por_tipo_comprobante', v_por_comprobante
    );
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.reporte_ventas_dia(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.reporte_ventas_dia(TEXT) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.reporte_ventas_dia IS
    'v1.0 — Resumen de ventas de un día: totales, desglose por método de pago y tipo de comprobante. '
    'Ventas anuladas se reportan aparte. Fechas en zona Ecuador (America/Guayaquil).';
