-- ==========================================
-- fn_listar_cuentas_cobrar
-- ==========================================
-- Lista clientes con ventas fiadas pendientes (total o parcialmente).
-- Agrupa por cliente, suma la deuda total y ordena por mayor deuda primero.
-- Soporta búsqueda por nombre / identificación / teléfono del cliente.
-- Paginada: p_page 0-indexed, p_page_size filas por página.
--
-- Retorna: SETOF JSON con campos de CuentaCliente
-- ==========================================

CREATE OR REPLACE FUNCTION fn_listar_cuentas_cobrar(
    p_busqueda  TEXT    DEFAULT NULL,
    p_page      INTEGER DEFAULT 0,
    p_page_size INTEGER DEFAULT 20
)
RETURNS TABLE (
    cliente_id             UUID,
    cliente_nombre         VARCHAR,
    cliente_identificacion VARCHAR,
    cliente_telefono       VARCHAR,
    total_deuda            DECIMAL,
    cantidad_ventas        BIGINT,
    ultima_venta_fecha     TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        c.id                                                         AS cliente_id,
        c.nombre                                                     AS cliente_nombre,
        c.identificacion                                             AS cliente_identificacion,
        c.telefono                                                   AS cliente_telefono,
        SUM(v.total - COALESCE(pagos.total_pagado, 0))::DECIMAL      AS total_deuda,
        COUNT(v.id)                                                  AS cantidad_ventas,
        MAX(v.fecha)                                                 AS ultima_venta_fecha
    FROM ventas v
    JOIN clientes c ON c.id = v.cliente_id
    LEFT JOIN (
        SELECT venta_id, SUM(monto) AS total_pagado
        FROM cuentas_cobrar
        GROUP BY venta_id
    ) pagos ON pagos.venta_id = v.id
    WHERE
        v.metodo_pago = 'FIADO'
        AND v.estado       = 'COMPLETADA'
        AND v.estado_pago  IN ('PENDIENTE', 'PAGADO_PARCIAL')
        AND (
            p_busqueda IS NULL
            OR p_busqueda = ''
            OR c.nombre         ILIKE '%' || p_busqueda || '%'
            OR c.identificacion ILIKE '%' || p_busqueda || '%'
            OR c.telefono       ILIKE '%' || p_busqueda || '%'
        )
    GROUP BY c.id, c.nombre, c.identificacion, c.telefono
    HAVING SUM(v.total - COALESCE(pagos.total_pagado, 0)) > 0
    ORDER BY total_deuda DESC
    LIMIT  p_page_size
    OFFSET p_page * p_page_size;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION fn_listar_cuentas_cobrar(TEXT, INTEGER, INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_listar_cuentas_cobrar(TEXT, INTEGER, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
