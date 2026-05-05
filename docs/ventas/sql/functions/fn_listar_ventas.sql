-- ==========================================
-- DROP — firmas anteriores
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_listar_ventas(TEXT, TEXT, INT, INT, TEXT);
DROP FUNCTION IF EXISTS public.fn_listar_ventas(TEXT, TEXT, INT, INT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.fn_listar_ventas(TEXT, TEXT, INT, INT, TEXT, UUID, INTEGER);

-- ==========================================
-- FUNCIÓN: fn_listar_ventas (v1.4)
-- ==========================================
-- Lista paginada de ventas con soporte de filtro por período, búsqueda libre,
-- estado y turno. Todos los roles ven todas las ventas.
-- El filtro por turno es solo visible para ADMIN (client-side).
--
-- v1.4 — Simplificado: todos los roles ven todas las ventas. Filtro de turno
--         solo disponible para ADMIN en el frontend.
-- v1.3 — Agrega: p_turno_id para filtrar ventas de un turno específico.
--
-- Llamada desde: VentasService.obtenerVentas()
-- Parámetros:
--   p_filtro     — 'hoy' | 'semana' | 'mes' | 'todo' | 'YYYY-MM-DD'
--   p_busqueda   — término libre (nombre, cédula o nro. comprobante). NULL = sin filtro
--   p_page       — página 0-based
--   p_page_size  — registros por página (default 10)
--   p_estado     — 'COMPLETADA' | 'ANULADA' | NULL (NULL = solo COMPLETADA, default operativo)
--   p_turno_id   — UUID del turno. NULL = todos los turnos del período
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_listar_ventas(
    p_filtro    TEXT    DEFAULT 'hoy',
    p_busqueda  TEXT    DEFAULT NULL,
    p_page      INT     DEFAULT 0,
    p_page_size INT     DEFAULT 10,
    p_estado    TEXT    DEFAULT NULL,
    p_turno_id  UUID    DEFAULT NULL
)
RETURNS TABLE (
    id                    UUID,
    turno_id              UUID,
    empleado_id           UUID,
    cliente_id            UUID,
    tipo_comprobante      TEXT,
    numero_comprobante    INTEGER,
    subtotal              NUMERIC,
    total                 NUMERIC,
    base_iva_0            NUMERIC,
    base_iva_15           NUMERIC,
    iva_valor             NUMERIC,
    metodo_pago           TEXT,
    estado                TEXT,
    fecha                 TIMESTAMPTZ,
    cliente_nombre        TEXT,
    cliente_identificacion TEXT,
    empleado_nombre       TEXT
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
        -- Lunes de la semana actual en Ecuador (ISODOW: 1=Lun … 7=Dom)
        v_inicio := ((v_fecha_local - (EXTRACT(ISODOW FROM v_fecha_local)::INT - 1) * INTERVAL '1 day')::TIMESTAMP
                     AT TIME ZONE 'America/Guayaquil');
        v_fin    := NULL;  -- sin límite superior

    ELSIF p_filtro = 'mes' THEN
        -- Primer día del mes actual en Ecuador
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

    -- ── Query principal ─────────────────────────────────────────────────────
    RETURN QUERY
    SELECT
        v.id,
        v.turno_id,
        v.empleado_id,
        v.cliente_id,
        v.tipo_comprobante::TEXT,
        v.numero_comprobante,
        v.subtotal,
        v.total,
        v.base_iva_0,
        v.base_iva_15,
        v.iva_valor,
        v.metodo_pago::TEXT,
        v.estado::TEXT,
        v.fecha,
        c.nombre::TEXT          AS cliente_nombre,
        c.identificacion::TEXT  AS cliente_identificacion,
        e.nombre::TEXT          AS empleado_nombre
    FROM ventas v
    LEFT JOIN clientes  c ON v.cliente_id  = c.id
    LEFT JOIN usuarios  e ON v.empleado_id = e.id
    WHERE v.estado = COALESCE(p_estado, 'COMPLETADA')
      -- Filtro de turno (solo ADMIN lo usa desde el frontend)
      AND (p_turno_id IS NULL OR v.turno_id = p_turno_id)
      -- Filtro de fecha
      AND (v_inicio IS NULL OR v.fecha >= v_inicio)
      AND (v_fin    IS NULL OR v.fecha <  v_fin)
      -- Búsqueda libre: tipo+número, solo número, nombre o cédula
      AND (
          v_term IS NULL
          OR v.numero_comprobante::TEXT ILIKE '%' || v_term || '%'
          -- "factura 10", "nota venta 5", "ticket 3"
          -- Usa regex con límites de palabra (\m inicio, \M fin) para evitar que
          -- "ticket 1" coincida con "ticket 10" o "ticket 11"
          OR (REPLACE(v.tipo_comprobante::TEXT, '_', ' ') || ' ' || COALESCE(v.numero_comprobante::TEXT, ''))
                 ~* ('\m' || v_term_regex || '\M')
          OR c.nombre         ILIKE '%' || v_term || '%'
          OR c.identificacion ILIKE '%' || v_term || '%'
      )
    ORDER BY v.fecha DESC
    OFFSET p_page * p_page_size
    LIMIT  p_page_size;
END;
$$;

-- ==========================================
-- PERMISOS
-- ==========================================
REVOKE EXECUTE ON FUNCTION public.fn_listar_ventas(TEXT, TEXT, INT, INT, TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_listar_ventas(TEXT, TEXT, INT, INT, TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
