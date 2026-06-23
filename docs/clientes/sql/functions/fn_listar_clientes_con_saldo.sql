-- ==========================================
-- fn_listar_clientes_con_saldo
-- ==========================================
-- Lista TODOS los clientes del negocio (excepto consumidor final)
-- con su saldo pendiente de ventas fiadas agregado.
-- Clientes sin deuda retornan total_deuda = 0 y cantidad_ventas_fiadas = 0.
-- Orden: clientes con deuda primero (mayor deuda arriba), luego el resto por nombre.
-- Soporta búsqueda por nombre, identificación o teléfono.
-- Paginada: p_page 0-indexed.
-- ==========================================

CREATE OR REPLACE FUNCTION fn_listar_clientes_con_saldo(
    p_busqueda  TEXT    DEFAULT NULL,
    p_page      INTEGER DEFAULT 0,
    p_page_size INTEGER DEFAULT 25
)
RETURNS TABLE (
    cliente_id             UUID,
    cliente_nombre         VARCHAR,
    cliente_identificacion VARCHAR,
    cliente_telefono       VARCHAR,
    total_deuda            DECIMAL,
    cantidad_ventas_fiadas BIGINT,
    ultima_venta_fecha     TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        c.id                                                                AS cliente_id,
        c.nombre                                                            AS cliente_nombre,
        c.identificacion                                                    AS cliente_identificacion,
        c.telefono                                                          AS cliente_telefono,
        COALESCE(deuda.total_deuda, 0)::DECIMAL                            AS total_deuda,
        COALESCE(deuda.cantidad_ventas, 0)                                 AS cantidad_ventas_fiadas,
        deuda.ultima_venta_fecha                                            AS ultima_venta_fecha
    FROM clientes c
    LEFT JOIN (
        SELECT
            v.cliente_id,
            SUM(v.total - COALESCE(pagos.total_pagado, 0)) AS total_deuda,
            COUNT(v.id)                                     AS cantidad_ventas,
            MAX(v.fecha)                                    AS ultima_venta_fecha
        FROM ventas v
        LEFT JOIN (
            SELECT venta_id, SUM(monto) AS total_pagado
            FROM cuentas_cobrar
            WHERE negocio_id = get_negocio_id()
            GROUP BY venta_id
        ) pagos ON pagos.venta_id = v.id
        WHERE
            v.negocio_id  = get_negocio_id()
            AND v.metodo_pago  = 'FIADO'
            AND v.estado       = 'COMPLETADA'
            AND v.estado_pago  IN ('PENDIENTE', 'PAGADO_PARCIAL')
        GROUP BY v.cliente_id
        HAVING SUM(v.total - COALESCE(pagos.total_pagado, 0)) > 0
    ) deuda ON deuda.cliente_id = c.id
    WHERE
        c.negocio_id        = get_negocio_id()
        AND c.es_consumidor_final = FALSE
        AND (
            p_busqueda IS NULL
            OR p_busqueda = ''
            OR c.nombre         ILIKE '%' || p_busqueda || '%'
            OR c.identificacion ILIKE '%' || p_busqueda || '%'
            OR c.telefono       ILIKE '%' || p_busqueda || '%'
        )
    ORDER BY
        deuda.total_deuda DESC NULLS LAST,
        c.nombre ASC
    LIMIT  LEAST(GREATEST(p_page_size, 1), 200)
    OFFSET p_page * LEAST(GREATEST(p_page_size, 1), 200);
$$;

REVOKE EXECUTE ON FUNCTION fn_listar_clientes_con_saldo(TEXT, INTEGER, INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_listar_clientes_con_saldo(TEXT, INTEGER, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
