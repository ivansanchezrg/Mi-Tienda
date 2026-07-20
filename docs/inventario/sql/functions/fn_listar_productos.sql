DROP FUNCTION IF EXISTS public.fn_listar_productos(TEXT, UUID, INT, INT);
DROP FUNCTION IF EXISTS public.fn_listar_productos(TEXT, UUID, UUID, INT, INT);
DROP FUNCTION IF EXISTS public.fn_listar_productos(TEXT, UUID, UUID, INT, INT, BOOLEAN);

-- ==========================================
-- fn_listar_productos (v2.2 — campo favorito)
-- ==========================================
-- Lista productos activos con filtro por categoría (simples y variantes),
-- filtro por template, búsqueda por nombre/código de barras, y paginación.
--
-- v2.2 (2026-07-16) — + campo `favorito` en el JSON (toggle de favoritos en
--   Inventario / tab Favoritos del POS — ver docs/inventario/INVENTARIO-README.md
--   y docs/pos/POS-README.md → "Favoritos").
--   Sin p_solo_favoritos: el filtro de favoritos es exclusivo del POS y client-side.
--
-- v2.1 (2026-07-08) — FILTRO "REPONER":
--   + `p_solo_stock_bajo BOOLEAN DEFAULT FALSE` — cuando es TRUE, devuelve solo
--     los productos con `stock_actual <= stock_minimo` (lo que hay que reabastecer).
--     Se aplica en el WHERE para respetar la paginación e infinite-scroll
--     (filtrar client-side solo cubriría las páginas ya descargadas).
--     Panel operativo del inventario — responde "¿qué compro?".
--
-- v2.0 (2026-05-30) — PERFORMANCE:
--   Reemplaza 3 subqueries por fila (categoria, template.categoria, presentaciones)
--   por JOINs explícitos:
--     - `LEFT JOIN producto_templates` (ya existía)
--     - `LEFT JOIN categorias_productos cat_efectiva` — categoría visible (template o producto)
--     - `LEFT JOIN categorias_productos cat_template` — categoría del template (anidada)
--     - `LEFT JOIN LATERAL` con `json_agg` — presentaciones del producto
--
--   Antes: con LIMIT 24, ~72 subqueries adicionales por llamada (24 × 3).
--   Después: 3 JOINs constantes (independiente del LIMIT).
--
--   Contrato JSON sin cambios — todos los campos antiguos siguen devolviendo
--   exactamente lo mismo. El consumidor (inventario.page, kardex) no requiere ajustes.
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_listar_productos(
    p_buscar          TEXT    DEFAULT NULL,
    p_categoria_id    UUID    DEFAULT NULL,
    p_template_id     UUID    DEFAULT NULL,
    p_from            INT     DEFAULT 0,
    p_to              INT     DEFAULT 24,
    p_solo_stock_bajo BOOLEAN DEFAULT FALSE
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
            'favorito',             p.favorito,
            'imagen_url',           p.imagen_url,
            'categoria_id',         COALESCE(t.categoria_id, p.categoria_id),
            'tipo_venta',           COALESCE(t.tipo_venta,   p.tipo_venta),
            'unidad_medida',        COALESCE(t.unidad_medida,p.unidad_medida),
            'updated_at',           p.updated_at,
            'created_at',           p.created_at,
            -- categoría efectiva (del template si es variante, del producto si es simple)
            'categoria', CASE
                WHEN cat_efectiva.id IS NULL THEN NULL
                ELSE row_to_json(cat_efectiva)
            END,
            -- producto_template con su propia categoría anidada (NULL si producto simple)
            'producto_template', CASE
                WHEN t.id IS NULL THEN NULL
                ELSE json_build_object(
                    'id',            t.id,
                    'nombre',        t.nombre,
                    'categoria_id',  t.categoria_id,
                    'tipo_venta',    t.tipo_venta,
                    'unidad_medida', t.unidad_medida,
                    'imagen_url',    t.imagen_url,
                    'activo',        t.activo,
                    'created_at',    t.created_at,
                    'categoria', CASE
                        WHEN cat_template.id IS NULL THEN NULL
                        ELSE row_to_json(cat_template)
                    END
                )
            END,
            'presentaciones', COALESCE(pres.presentaciones, '[]'::json)
        )
    FROM productos p
    LEFT JOIN producto_templates t
        ON t.id = p.producto_template_id
    LEFT JOIN categorias_productos cat_efectiva
        ON cat_efectiva.id = COALESCE(t.categoria_id, p.categoria_id)
       AND cat_efectiva.negocio_id = p.negocio_id
    LEFT JOIN categorias_productos cat_template
        ON cat_template.id = t.categoria_id
       AND cat_template.negocio_id = p.negocio_id
    LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('id', pp.id)) AS presentaciones
        FROM producto_presentaciones pp
        WHERE pp.producto_id = p.id AND pp.activo = TRUE
    ) pres ON TRUE
    WHERE p.negocio_id = public.get_negocio_id()
      AND p.activo = TRUE
      AND (
          p_buscar IS NULL
          OR p.nombre        ILIKE '%' || p_buscar || '%'
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
      AND (
          p_solo_stock_bajo IS NOT TRUE
          OR p.stock_actual <= p.stock_minimo
      )
    ORDER BY p.nombre
    LIMIT  (p_to - p_from + 1)
    OFFSET p_from;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_listar_productos(TEXT, UUID, UUID, INT, INT, BOOLEAN) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_listar_productos(TEXT, UUID, UUID, INT, INT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_listar_productos IS
    'v2.2 — + campo favorito en el JSON. v2.1 — + p_solo_stock_bajo (filtro "Reponer"). '
    'v2.0 — Performance: JOINs explícitos en vez de subqueries por fila. '
    'Contrato JSON: solo agrega campos, no cambia los existentes.';
