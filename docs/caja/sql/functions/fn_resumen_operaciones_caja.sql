-- ==========================================
-- fn_resumen_operaciones_caja
-- ==========================================
-- Totales de Ingresos/Egresos del período activo en la página de Operaciones
-- de Caja. El balance card necesita el total REAL del período filtrado, no
-- solo lo que el infinite scroll ya cargó en pantalla — antes se calculaba
-- en el cliente sumando operaciones.ts (operacion-caja.page.ts), y con
-- filtro "Todo" en cajas con mucho historial el total quedaba parcial hasta
-- scrollear todo. Esta función agrega en SQL sobre toda la tabla, sin
-- depender de paginación.
--
-- Rango [p_desde, p_hasta) — mismo criterio que el filtro del listado
-- (obtenerOperacionesCaja). Ambos NULL → sin acotar (filtro "Todo" de la UI).
-- Cada cota es independiente: se aplica solo la que venga con valor.
--
-- Clasificación de tipos replicada de operaciones-caja.page.ts (esIngresoReal/
-- esEgresoReal): CIERRE cuenta como ingreso (dinero que entró a la caja).
-- APERTURA y AJUSTE son neutros — no suman a ningún lado.
--
-- LANGUAGE plpgsql STABLE: lectura pura. Sin fn_assert_no_superadmin
--   (el superadmin sí necesita poder revisar el resumen).
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_resumen_operaciones_caja(UUID, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS public.fn_resumen_operaciones_caja(UUID, TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.fn_resumen_operaciones_caja(
    p_caja_id UUID,
    p_desde   TIMESTAMPTZ DEFAULT NULL,
    p_hasta   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    total_ingresos DECIMAL(12,2),
    total_egresos  DECIMAL(12,2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id UUID;
BEGIN
    v_negocio_id := public.get_negocio_id();
    IF v_negocio_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        COALESCE(SUM(o.monto) FILTER (
            WHERE o.tipo_operacion IN ('INGRESO', 'TRANSFERENCIA_ENTRANTE', 'CIERRE')
        ), 0)::DECIMAL(12,2),
        COALESCE(SUM(o.monto) FILTER (
            WHERE o.tipo_operacion IN ('EGRESO', 'TRANSFERENCIA_SALIENTE')
        ), 0)::DECIMAL(12,2)
    FROM operaciones_cajas o
    WHERE o.negocio_id = v_negocio_id
      AND o.caja_id    = p_caja_id
      AND (p_desde IS NULL OR o.fecha >= p_desde)
      AND (p_hasta IS NULL OR o.fecha <  p_hasta);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_resumen_operaciones_caja(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_resumen_operaciones_caja(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

NOTIFY pgrst, 'reload schema';
