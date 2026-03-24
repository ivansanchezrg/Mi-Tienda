-- ==========================================
-- fn_resumir_cuentas_cobrar
-- ==========================================
-- Devuelve el resumen global de cuentas por cobrar:
--   • total_clientes  — cuántos clientes distintos tienen deuda
--   • total_deuda     — suma total adeudada ($)
--
-- Soporta el mismo filtro de búsqueda que fn_listar_cuentas_cobrar
-- para que el footer coincida exactamente con la lista filtrada.
--
-- SIEMPRE devuelve exactamente 1 fila (con 0s si no hay deudas).
--
-- ¿Por qué función y no query directa?
--   • Llamado via supabase.rpc() — requiere función PostgreSQL.
--   • La lógica de filtrado aplicado a un agregado multi-tabla es compleja
--     para el query builder de Supabase.
--
-- LANGUAGE sql STABLE: lectura pura, más eficiente que plpgsql para SELECTs.
-- ==========================================

CREATE OR REPLACE FUNCTION fn_resumir_cuentas_cobrar(
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
    -- Subquery para calcular por cliente; luego agregar en fila única.
    -- COALESCE(..., 0) garantiza que siempre se retorna 1 fila aun sin datos.
    SELECT
        COALESCE(COUNT(DISTINCT base.cliente_id), 0)::BIGINT  AS total_clientes,
        COALESCE(SUM(base.saldo_pendiente), 0)::DECIMAL        AS total_deuda
    FROM (
        SELECT
            c.id                                                      AS cliente_id,
            SUM(v.total - COALESCE(pagos.total_pagado, 0))::DECIMAL   AS saldo_pendiente
        FROM ventas v
        JOIN clientes c ON c.id = v.cliente_id
        LEFT JOIN (
            SELECT venta_id, SUM(monto) AS total_pagado
            FROM cuentas_cobrar
            GROUP BY venta_id
        ) pagos ON pagos.venta_id = v.id
        WHERE
            v.metodo_pago = 'FIADO'
            AND v.estado      = 'COMPLETADA'
            AND v.estado_pago IN ('PENDIENTE', 'PAGADO_PARCIAL')
            AND (
                p_busqueda IS NULL
                OR p_busqueda = ''
                OR c.nombre         ILIKE '%' || p_busqueda || '%'
                OR c.identificacion ILIKE '%' || p_busqueda || '%'
                OR c.telefono       ILIKE '%' || p_busqueda || '%'
            )
        GROUP BY c.id
        HAVING SUM(v.total - COALESCE(pagos.total_pagado, 0)) > 0
    ) base;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION fn_resumir_cuentas_cobrar(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_resumir_cuentas_cobrar(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
