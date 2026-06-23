-- ==========================================
-- fn_catalogo_productos_pos (v1.0 — 2026-05-30)
-- ==========================================
-- Catálogo visual del POS — grid de productos con filtro por categoría.
-- Devuelve TODOS los productos activos del negocio (sin paginación),
-- con presentaciones completas + template (id, nombre, imagen_url) y
-- nombres de los atributos del template (para el chip de variante en la UI).
--
-- 🔒 FIX del bug detectado el 2026-05-30:
--   La query directa anterior filtraba `productos.categoria_id = X`, pero en
--   las variantes ese campo es NULL (la categoría vive en el template).
--   Resultado: filtrar por categoría OCULTABA las variantes.
--   Esta función usa `COALESCE(t.categoria_id, p.categoria_id) = p_categoria_id`
--   que aplica tanto a simples como a variantes.
--
-- Diferencias con fn_listar_productos:
--   • Presentaciones COMPLETAS (no solo IDs)
--   • Template incluye template_atributos[].atributo.nombre (anidado)
--   • Sin paginación — el POS muestra todo el catálogo
--   • Sin búsqueda libre por texto — solo filtro por categoría
--
-- Llamado desde: InventarioService.obtenerProductosCatalogoPOS()
-- LANGUAGE sql STABLE — lectura pura.
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_catalogo_productos_pos(UUID);

CREATE OR REPLACE FUNCTION public.fn_catalogo_productos_pos(
    p_categoria_id UUID DEFAULT NULL
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
                ELSE json_build_object(
                    'id',          t.id,
                    'nombre',      t.nombre,
                    'imagen_url',  t.imagen_url,
                    'template_atributos', COALESCE(ta.lista, '[]'::json)
                )
            END,
            'presentaciones', COALESCE(pres.lista, '[]'::json)
        )
    FROM productos p
    LEFT JOIN producto_templates t
        ON t.id = p.producto_template_id
    -- Atributos del template (NULL para productos simples)
    LEFT JOIN LATERAL (
        SELECT json_agg(
            json_build_object(
                'atributo', json_build_object('nombre', a.nombre)
            )
        ) AS lista
        FROM template_atributos ta
        JOIN atributos a ON a.id = ta.atributo_id
        WHERE ta.template_id = t.id
    ) ta ON t.id IS NOT NULL
    -- Presentaciones activas del producto
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
      -- Filtro por categoría: aplica a simples (p.categoria_id) Y variantes (t.categoria_id)
      AND (
          p_categoria_id IS NULL
          OR COALESCE(t.categoria_id, p.categoria_id) = p_categoria_id
      )
    ORDER BY p.nombre;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_catalogo_productos_pos(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_catalogo_productos_pos(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_catalogo_productos_pos IS
    'v1.0 — Catálogo POS con filtro por categoría que aplica a simples Y variantes
    (COALESCE template/producto). Devuelve presentaciones completas y atributos del template.
    Multi-tenant: filtra por get_negocio_id() del JWT.';
