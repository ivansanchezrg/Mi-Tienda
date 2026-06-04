-- ==========================================
-- fn_resumir_cuentas_cobrar
-- ==========================================
-- Devuelve el resumen de cuentas por cobrar del negocio activo:
--   • total_clientes  — cuántos clientes distintos tienen deuda
--   • total_deuda     — suma total adeudada ($)
--
-- v1.1 (2026-05-30) — SEGURIDAD MULTI-TENANT:
--   Agrega filtro explícito v.negocio_id = get_negocio_id() y
--   c.negocio_id = get_negocio_id(). Sin este filtro la función
--   sumaba deuda de TODOS los tenants (SECURITY DEFINER bypasa RLS).
--
-- Soporta el mismo filtro de búsqueda que fn_listar_cuentas_cobrar
-- para que el footer coincida exactamente con la lista filtrada.
--
-- SIEMPRE devuelve exactamente 1 fila (con 0s si no hay deudas).
--
-- LANGUAGE sql STABLE: lectura pura, más eficiente que plpgsql para SELECTs.
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_resumir_cuentas_cobrar(TEXT);

CREATE OR REPLACE FUNCTION public.fn_resumir_cuentas_cobrar(
    p_busqueda TEXT DEFAULT NULL
)
RETURNS TABLE (
    total_clientes BIGINT,
    total_deuda    DECIMAL
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        COALESCE(COUNT(DISTINCT base.cliente_id), 0)::BIGINT  AS total_clientes,
        COALESCE(SUM(base.saldo_pendiente), 0)::DECIMAL        AS total_deuda
    FROM (
        SELECT
            c.id                                                      AS cliente_id,
            SUM(v.total - COALESCE(pagos.total_pagado, 0))::DECIMAL   AS saldo_pendiente
        FROM ventas v
        JOIN clientes c
            ON c.id = v.cliente_id
           AND c.negocio_id = public.get_negocio_id()
        LEFT JOIN (
            SELECT venta_id, SUM(monto) AS total_pagado
            FROM cuentas_cobrar
            WHERE negocio_id = public.get_negocio_id()
            GROUP BY venta_id
        ) pagos ON pagos.venta_id = v.id
        WHERE
            v.negocio_id  = public.get_negocio_id()
            AND v.metodo_pago = 'FIADO'
            AND v.estado      = 'COMPLETADA'
            AND v.estado_pago IN ('PENDIENTE', 'PAGADO_PARCIAL')
            AND (
                p_busqueda IS NULL
                OR p_busqueda = ''
                OR c.nombre         ILIKE '%' || p_busqueda || '%'
                OR c.identificacion ILIKE '%' || p_busqueda || '%'
            )
        GROUP BY c.id
        HAVING SUM(v.total - COALESCE(pagos.total_pagado, 0)) > 0
    ) base;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_resumir_cuentas_cobrar(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_resumir_cuentas_cobrar(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
