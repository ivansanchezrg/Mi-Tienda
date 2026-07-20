-- ==========================================
-- fn_reordenar_categorias (v1.0 — 2026-07-16)
-- ==========================================
-- Persiste el orden manual de las categorías de productos definido por el usuario
-- con drag & drop en Configuración → Categorías de Producto.
--
-- Recibe los IDs YA en el orden deseado y asigna orden = posición (0-based) en un
-- solo UPDATE atómico (unnest WITH ORDINALITY) — nunca deja un reorden a medias.
--
-- La UI solo lista categorías activas: el reorden reasigna 0..N-1 entre activas;
-- las inactivas conservan su orden anterior (irrelevante — nunca se listan).
--
-- Multi-tenant: SECURITY DEFINER bypassa RLS → se valida manualmente que TODOS los
-- IDs pertenezcan al negocio del JWT antes de tocar nada.
--
-- Llamado desde: InventarioService.reordenarCategorias()
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_reordenar_categorias(UUID[]) CASCADE;

CREATE OR REPLACE FUNCTION public.fn_reordenar_categorias(
    p_categoria_ids UUID[]
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id UUID;
    v_propias    INT;
BEGIN
    PERFORM public.fn_assert_no_superadmin();

    v_negocio_id := public.get_negocio_id();

    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'Sin negocio activo en el JWT';
    END IF;

    IF p_categoria_ids IS NULL OR array_length(p_categoria_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'La lista de categorías está vacía';
    END IF;

    -- 🔒 Multi-tenant: todos los IDs deben pertenecer al negocio activo
    v_propias := (
        SELECT COUNT(*) FROM categorias_productos
        WHERE id = ANY(p_categoria_ids) AND negocio_id = v_negocio_id
    );
    IF v_propias <> array_length(p_categoria_ids, 1) THEN
        RAISE EXCEPTION 'Alguna categoría no pertenece a este negocio';
    END IF;

    -- Un solo UPDATE atómico: orden = posición en el array (0-based)
    UPDATE categorias_productos c
    SET orden = x.ord - 1
    FROM unnest(p_categoria_ids) WITH ORDINALITY AS x(id, ord)
    WHERE c.id = x.id
      AND c.negocio_id = v_negocio_id;

    RETURN json_build_object('ok', TRUE, 'total', v_propias);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_reordenar_categorias(UUID[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_reordenar_categorias(UUID[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_reordenar_categorias IS
    'v1.0 — Orden manual de categorías de productos (drag & drop). UPDATE atómico via
    unnest WITH ORDINALITY. Multi-tenant: valida pertenencia de todos los IDs al negocio
    del JWT. Bloqueado para superadmin.';
