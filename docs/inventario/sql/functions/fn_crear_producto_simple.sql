-- ==========================================
-- fn_crear_producto_simple
-- Crea un producto simple (sin variantes) con sus presentaciones opcionales.
-- Toda la operacion es atomica: si algo falla, no se persiste nada.
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_crear_producto_simple CASCADE;

CREATE OR REPLACE FUNCTION public.fn_crear_producto_simple(
    p_nombre            TEXT,
    p_categoria_id      UUID,
    p_tiene_iva         BOOLEAN,
    p_tipo_venta        TEXT,
    p_unidad_medida     TEXT,
    p_codigo_barras     TEXT DEFAULT NULL,
    p_imagen_url        TEXT DEFAULT NULL,
    p_precio_costo      NUMERIC DEFAULT 0,
    p_precio_venta      NUMERIC DEFAULT 0,
    p_stock_actual      NUMERIC DEFAULT 0,
    p_stock_minimo      INTEGER DEFAULT 5,
    p_favorito          BOOLEAN DEFAULT FALSE,
    -- Presentaciones: [{ nombre, factor_conversion, precio_venta, precio_costo, codigo_barras?, imagen_url? }]
    p_presentaciones    JSON DEFAULT '[]'::JSON
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id     UUID;
    v_producto_id    UUID;
    v_pres           JSON;
    v_presentaciones JSON;
BEGIN
    PERFORM public.fn_assert_no_superadmin();

    v_negocio_id := public.get_negocio_id();

    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'Sin negocio activo en el JWT';
    END IF;

    -- Normalizar presentaciones: asegurar que sea un JSON array
    BEGIN
        v_presentaciones := p_presentaciones::TEXT::JSON;
        IF json_typeof(v_presentaciones) <> 'array' THEN
            v_presentaciones := '[]'::JSON;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_presentaciones := '[]'::JSON;
    END;

    -- Validaciones
    IF TRIM(COALESCE(p_nombre, '')) = '' THEN
        RAISE EXCEPTION 'El nombre del producto es obligatorio';
    END IF;

    IF p_precio_venta <= 0 THEN
        RAISE EXCEPTION 'El precio de venta debe ser mayor a 0';
    END IF;

    -- 🔒 Multi-tenant: la categoría debe pertenecer al negocio activo
    IF p_categoria_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM categorias_productos
        WHERE id = p_categoria_id AND negocio_id = v_negocio_id
    ) THEN
        RAISE EXCEPTION 'La categoría no pertenece a este negocio';
    END IF;

    -- Crear producto
    v_producto_id := gen_random_uuid();

    INSERT INTO productos (
        id, negocio_id,
        nombre, categoria_id, tiene_iva, tipo_venta, unidad_medida,
        codigo_barras, imagen_url,
        precio_costo, precio_venta, stock_actual, stock_minimo,
        favorito, activo
    ) VALUES (
        v_producto_id, v_negocio_id,
        TRIM(p_nombre), p_categoria_id, p_tiene_iva, p_tipo_venta, p_unidad_medida,
        NULLIF(TRIM(COALESCE(p_codigo_barras, '')), ''), p_imagen_url,
        p_precio_costo, p_precio_venta, p_stock_actual, p_stock_minimo,
        COALESCE(p_favorito, FALSE), TRUE
    );

    -- Presentaciones (opcional)
    IF json_array_length(v_presentaciones) > 0 THEN
        FOR v_pres IN
            SELECT value FROM json_array_elements(v_presentaciones)
        LOOP
            INSERT INTO producto_presentaciones (
                negocio_id, producto_id, nombre, factor_conversion,
                precio_venta, precio_costo, codigo_barras, imagen_url, activo
            ) VALUES (
                v_negocio_id,
                v_producto_id,
                TRIM(v_pres->>'nombre'),
                (v_pres->>'factor_conversion')::DECIMAL(12,4),
                (v_pres->>'precio_venta')::NUMERIC,
                (v_pres->>'precio_costo')::NUMERIC,
                NULLIF(TRIM(COALESCE(v_pres->>'codigo_barras', '')), ''),
                NULLIF(TRIM(COALESCE(v_pres->>'imagen_url', '')), ''),
                TRUE
            );
        END LOOP;
    END IF;

    RETURN json_build_object(
        'ok', TRUE,
        'producto_id', v_producto_id
    );
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_crear_producto_simple FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_crear_producto_simple TO authenticated;

NOTIFY pgrst, 'reload schema';
