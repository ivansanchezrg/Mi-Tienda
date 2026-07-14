-- ==========================================
-- fn_actualizar_template (v1.0 — 2026-07-13)
-- ==========================================
-- Actualiza los datos "generales" de un producto con variantes (el template):
-- nombre, categoria e imagen general que representa a todo el grupo de variantes.
--
-- Contexto del bug que resuelve:
--   Al crear un producto con variantes se puede subir una imagen general (va a
--   producto_templates.imagen_url). Si el usuario NO la sube en ese momento, no
--   existía ninguna forma en la UI de agregarla/cambiarla después — la edición de
--   una variante solo toca productos.imagen_url (la del SKU), nunca la del template.
--   Esta función habilita esa edición desde la nueva página de edición del template.
--
-- Multi-tenant: SECURITY DEFINER bypassa RLS, por eso se valida manualmente que el
--   template Y la categoría pertenezcan al negocio activo (get_negocio_id()).
--
-- La categoría del template es la fuente de verdad para todas sus variantes
--   (los SKUs tienen categoria_id NULL — ver fn_catalogo_productos_pos). Por eso
--   cambiar la categoría aquí reclasifica el grupo completo.
--
-- Llamado desde: ProductoService.actualizarTemplate()
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_actualizar_template(UUID, TEXT, UUID, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.fn_actualizar_template(
    p_template_id   UUID,
    p_nombre        TEXT,
    p_categoria_id  UUID,
    p_imagen_url    TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id  UUID;
BEGIN
    PERFORM public.fn_assert_no_superadmin();

    v_negocio_id := public.get_negocio_id();

    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'Sin negocio activo en el JWT';
    END IF;

    -- Validaciones
    IF TRIM(COALESCE(p_nombre, '')) = '' THEN
        RAISE EXCEPTION 'El nombre del producto es obligatorio';
    END IF;

    -- 🔒 Multi-tenant: el template debe pertenecer al negocio activo
    IF NOT EXISTS (
        SELECT 1 FROM producto_templates
        WHERE id = p_template_id AND negocio_id = v_negocio_id
    ) THEN
        RAISE EXCEPTION 'El producto no pertenece a este negocio';
    END IF;

    -- 🔒 Multi-tenant: la categoría debe pertenecer al negocio activo
    IF p_categoria_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM categorias_productos
        WHERE id = p_categoria_id AND negocio_id = v_negocio_id
    ) THEN
        RAISE EXCEPTION 'La categoría no pertenece a este negocio';
    END IF;

    UPDATE producto_templates
    SET nombre       = TRIM(p_nombre),
        categoria_id = p_categoria_id,
        imagen_url   = NULLIF(TRIM(COALESCE(p_imagen_url, '')), '')
    WHERE id = p_template_id
      AND negocio_id = v_negocio_id;

    RETURN json_build_object(
        'ok', TRUE,
        'template_id', p_template_id
    );
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_actualizar_template(UUID, TEXT, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_actualizar_template(UUID, TEXT, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_actualizar_template IS
    'v1.0 — Actualiza nombre, categoría e imagen general de un template (grupo de
    variantes). Multi-tenant: valida pertenencia del template y la categoría al
    negocio del JWT. Bloqueado para superadmin.';
