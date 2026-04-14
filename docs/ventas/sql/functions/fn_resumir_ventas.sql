-- ==========================================
-- DROP — firmas anteriores
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_resumir_ventas(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_resumir_ventas(TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.fn_resumir_ventas(TEXT, TEXT, TEXT, UUID, INTEGER);

-- ==========================================
-- FUNCIÓN: fn_resumir_ventas (v1.3)
-- ==========================================
-- Devuelve el total de registros y el monto acumulado de ventas
-- para un filtro de período + búsqueda + estado + turno, SIN paginación.
-- Todos los roles ven todas las ventas. El filtro de turno es solo para ADMIN.
--
-- v1.3 — Simplificado: todos los roles ven todas las ventas. Se elimina p_empleado_id.
-- v1.2 — Agrega: p_turno_id para filtrar ventas de un turno específico.
--
-- Llamada desde: VentasService.resumirVentas()
-- Parámetros:
--   p_filtro    — 'hoy' | 'semana' | 'mes' | 'todo' | 'YYYY-MM-DD'
--   p_busqueda  — término libre (nombre, cédula o nro. comprobante). NULL = sin filtro
--   p_estado    — 'COMPLETADA' | 'ANULADA' | NULL (NULL = solo COMPLETADA)
--   p_turno_id  — UUID del turno. NULL = todos los turnos del período
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_resumir_ventas(
    p_filtro    TEXT    DEFAULT 'hoy',
    p_busqueda  TEXT    DEFAULT NULL,
    p_estado    TEXT    DEFAULT NULL,
    p_turno_id  UUID    DEFAULT NULL
)
RETURNS TABLE (
    total_registros BIGINT,
    total_monto     NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_fecha_local   DATE;
    v_inicio        TIMESTAMPTZ;
    v_fin           TIMESTAMPTZ;
    v_term          TEXT;
    v_term_regex    TEXT;
BEGIN
    -- ── Fecha actual en Ecuador ─────────────────────────────────────────────
    v_fecha_local := (NOW() AT TIME ZONE 'America/Guayaquil')::DATE;

    -- ── Rango de fechas según filtro ────────────────────────────────────────
    IF p_filtro = 'hoy' THEN
        v_inicio := (v_fecha_local::TIMESTAMP         AT TIME ZONE 'America/Guayaquil');
        v_fin    := ((v_fecha_local + 1)::TIMESTAMP   AT TIME ZONE 'America/Guayaquil');

    ELSIF p_filtro = 'semana' THEN
        v_inicio := ((v_fecha_local - (EXTRACT(ISODOW FROM v_fecha_local)::INT - 1) * INTERVAL '1 day')::TIMESTAMP
                     AT TIME ZONE 'America/Guayaquil');
        v_fin    := NULL;

    ELSIF p_filtro = 'mes' THEN
        v_inicio := (DATE_TRUNC('month', v_fecha_local)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
        v_fin    := NULL;

    ELSIF p_filtro = 'todo' THEN
        v_inicio := NULL;
        v_fin    := NULL;

    ELSE
        -- Se asume 'YYYY-MM-DD' — fecha específica
        v_inicio := (p_filtro::DATE::TIMESTAMP         AT TIME ZONE 'America/Guayaquil');
        v_fin    := ((p_filtro::DATE + 1)::TIMESTAMP   AT TIME ZONE 'America/Guayaquil');
    END IF;

    -- ── Término de búsqueda: trim + versión escapada para regex ────────────
    v_term       := NULLIF(TRIM(p_busqueda), '');
    v_term_regex := regexp_replace(v_term, '([.+*?^${}()|[\]\\])', '\\\1', 'g');

    -- ── Query de agregación ─────────────────────────────────────────────────
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT    AS total_registros,
        COALESCE(SUM(v.total), 0) AS total_monto
    FROM ventas v
    LEFT JOIN clientes c ON v.cliente_id = c.id
    WHERE v.estado = COALESCE(p_estado, 'COMPLETADA')
      -- Filtro de turno (solo ADMIN lo usa desde el frontend)
      AND (p_turno_id IS NULL OR v.turno_id = p_turno_id)
      AND (v_inicio IS NULL OR v.fecha >= v_inicio)
      AND (v_fin    IS NULL OR v.fecha <  v_fin)
      AND (
          v_term IS NULL
          OR v.numero_comprobante::TEXT ILIKE '%' || v_term || '%'
          OR (REPLACE(v.tipo_comprobante::TEXT, '_', ' ') || ' ' || COALESCE(v.numero_comprobante::TEXT, ''))
                 ~* ('\m' || v_term_regex || '\M')
          OR c.nombre         ILIKE '%' || v_term || '%'
          OR c.identificacion ILIKE '%' || v_term || '%'
      );
END;
$$;

-- ==========================================
-- PERMISOS
-- ==========================================
REVOKE EXECUTE ON FUNCTION public.fn_resumir_ventas(TEXT, TEXT, TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_resumir_ventas(TEXT, TEXT, TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
