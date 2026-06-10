-- ==========================================
-- fn_buscar_productos_pos (v1.0 — 2026-05-30)
-- ==========================================
-- Buscador del POS por texto libre (nombre o código de barras).
-- Devuelve productos activos del negocio activo con sus presentaciones completas
-- y nombre del template (si es variante).
--
-- Diferencias con fn_listar_productos:
--   • Presentaciones COMPLETAS (nombre, factor_conversion, precios, codigo_barras...)
--   • Limit fijo de 20 resultados (no paginado)
--   • Multi-tenant: filtra por public.get_negocio_id() del JWT
--   • Compatible con interfaz ProductoPOS en el frontend
--
-- Llamado desde: InventarioService.buscarProductosPOS()
-- LANGUAGE sql STABLE — lectura pura, sin efectos.
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_buscar_productos_pos(TEXT);

CREATE OR REPLACE FUNCTION public.fn_buscar_productos_pos(
    p_busqueda TEXT
)
RETURNS SETOF JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        json_build_object(
            'id',                   p.id,
            'nombre',               p.nombre,
            'codigo_barras',        p.codigo_barras,
            'precio_venta',         p.precio_venta,
            'stock_actual',         p.stock_actual,
            'stock_minimo',         p.stock_minimo,
            'imagen_url',           p.imagen_url,
            'tiene_iva',            p.tiene_iva,
            'tipo_venta',           COALESCE(t.tipo_venta,    p.tipo_venta),
            'unidad_medida',        COALESCE(t.unidad_medida, p.unidad_medida),
            'categoria_id',         COALESCE(t.categoria_id,  p.categoria_id),
            'producto_template_id', p.producto_template_id,
            'producto_template', CASE
                WHEN t.id IS NULL THEN NULL
                ELSE json_build_object('id', t.id, 'nombre', t.nombre)
            END,
            'presentaciones', COALESCE(pres.lista, '[]'::json)
        )
    FROM productos p
    LEFT JOIN producto_templates t
        ON t.id = p.producto_template_id
    LEFT JOIN LATERAL (
        SELECT json_agg(
            json_build_object(
                'id',                pp.id,
                'producto_id',       pp.producto_id,
                'nombre',            pp.nombre,
                'factor_conversion', pp.factor_conversion,
                'precio_venta',      pp.precio_venta,
                'precio_costo',      pp.precio_costo,
                'codigo_barras',     pp.codigo_barras,
                'imagen_url',        pp.imagen_url,
                'es_principal',      pp.es_principal,
                'activo',            pp.activo
            )
        ) AS lista
        FROM producto_presentaciones pp
        WHERE pp.producto_id = p.id AND pp.activo = TRUE
    ) pres ON TRUE
    WHERE p.negocio_id = public.get_negocio_id()
      AND p.activo = TRUE
      AND (
          p.nombre        ILIKE '%' || p_busqueda || '%'
          OR p.codigo_barras ILIKE '%' || p_busqueda || '%'
      )
    ORDER BY p.nombre
    LIMIT 20;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_buscar_productos_pos(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_buscar_productos_pos(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_buscar_productos_pos IS
    'v1.0 — Buscador POS por texto (nombre/código). Limite 20.
    Devuelve productos con presentaciones completas + nombre de template.
    Multi-tenant: filtra por get_negocio_id() del JWT.';
