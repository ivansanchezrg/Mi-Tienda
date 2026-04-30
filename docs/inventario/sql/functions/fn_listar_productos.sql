DROP FUNCTION IF EXISTS public.fn_listar_productos(TEXT, UUID, INT, INT);
DROP FUNCTION IF EXISTS public.fn_listar_productos(TEXT, UUID, UUID, INT, INT);

-- fn_listar_productos
-- Lista productos activos con filtro por categoria (simples Y variantes),
-- filtro por template, búsqueda por nombre/código de barras, y paginación.
-- Variantes: categoria_id vive en producto_templates, no en productos.

CREATE OR REPLACE FUNCTION public.fn_listar_productos(
    p_buscar       TEXT  DEFAULT NULL,
    p_categoria_id UUID  DEFAULT NULL,
    p_template_id  UUID  DEFAULT NULL,
    p_from         INT   DEFAULT 0,
    p_to           INT   DEFAULT 24
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
            'negocio_id',           p.negocio_id,
            'producto_template_id', p.producto_template_id,
            'nombre',               p.nombre,
            'codigo_barras',        p.codigo_barras,
            'precio_costo',         p.precio_costo,
            'precio_venta',         p.precio_venta,
            'stock_actual',         p.stock_actual,
            'stock_minimo',         p.stock_minimo,
            'tiene_iva',            p.tiene_iva,
            'activo',               p.activo,
            'imagen_url',           p.imagen_url,
            'categoria_id',         COALESCE(t.categoria_id, p.categoria_id),
            'tipo_venta',           COALESCE(t.tipo_venta,   p.tipo_venta),
            'unidad_medida',        COALESCE(t.unidad_medida,p.unidad_medida),
            'updated_at',           p.updated_at,
            'created_at',           p.created_at,
            'categoria', (
                SELECT row_to_json(c)
                FROM categorias_productos c
                WHERE c.id = COALESCE(t.categoria_id, p.categoria_id)
            ),
            'producto_template', CASE
                WHEN t.id IS NULL THEN NULL
                ELSE (
                    SELECT row_to_json(r) FROM (
                        SELECT
                            t.id,
                            t.nombre,
                            t.categoria_id,
                            t.tipo_venta,
                            t.unidad_medida,
                            t.imagen_url,
                            t.activo,
                            t.created_at,
                            (SELECT row_to_json(c2)
                             FROM categorias_productos c2
                             WHERE c2.id = t.categoria_id) AS categoria
                    ) r
                )
            END,
            'presentaciones', (
                SELECT COALESCE(json_agg(json_build_object('id', pp.id)), '[]'::json)
                FROM producto_presentaciones pp
                WHERE pp.producto_id = p.id AND pp.activo = TRUE
            )
        )
    FROM productos p
    LEFT JOIN producto_templates t ON t.id = p.producto_template_id
    WHERE p.negocio_id = get_negocio_id()
      AND p.activo = TRUE
      AND (
          p_buscar IS NULL
          OR p.nombre       ILIKE '%' || p_buscar || '%'
          OR p.codigo_barras ILIKE '%' || p_buscar || '%'
      )
      AND (
          p_categoria_id IS NULL
          OR COALESCE(t.categoria_id, p.categoria_id) = p_categoria_id
      )
      AND (
          p_template_id IS NULL
          OR p.producto_template_id = p_template_id
      )
    ORDER BY p.nombre
    LIMIT  (p_to - p_from + 1)
    OFFSET p_from;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_listar_productos(TEXT, UUID, UUID, INT, INT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_listar_productos(TEXT, UUID, UUID, INT, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';
