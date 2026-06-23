-- ==========================================
-- fn_crear_producto_con_variantes
-- Crea un producto con variantes: template + atributos + SKUs + presentaciones por SKU.
-- Toda la operacion es atomica: si algo falla, no se persiste nada.
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_crear_producto_con_variantes CASCADE;

CREATE OR REPLACE FUNCTION public.fn_crear_producto_con_variantes(
    -- Datos del template
    p_nombre            TEXT,
    p_categoria_id      UUID,
    p_tiene_iva         BOOLEAN,   -- aplica a los SKUs; el template ya no tiene este campo
    p_tipo_venta        TEXT,
    p_unidad_medida     TEXT,
    p_imagen_url        TEXT DEFAULT NULL,

    -- Definicion de atributos del template:
    -- [{ atributo_nombre, opcion_ids: [uuid] }]
    p_atributos_template JSON DEFAULT '[]'::JSON,

    -- Variantes (SKUs):
    -- [{ nombre, precio_costo, precio_venta, stock_actual, stock_minimo, imagen_url?, opcion_ids: [uuid], presentaciones?: [{ ..., imagen_url? }] }]
    p_variantes         JSON DEFAULT '[]'::JSON
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id        UUID;
    v_template_id       UUID;
    v_producto_id       UUID;
    v_atributo_nombre   TEXT;
    v_atributo_id       UUID;
    v_opcion_id         UUID;
    v_ta_id             UUID;
    v_variante          JSON;
    v_atributo_entry    JSON;
    v_opcion_id_val     TEXT;
    v_pres              JSON;
    v_skus_creados      INTEGER := 0;
    -- Variables JSON casteadas
    v_variantes         JSON;
    v_atributos_tmpl    JSON;
BEGIN
    PERFORM public.fn_assert_no_superadmin();

    v_negocio_id := public.get_negocio_id();

    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'Sin negocio activo en el JWT';
    END IF;

    -- Normalizar JSON: asegurar que sean arrays
    BEGIN
        v_variantes := p_variantes::TEXT::JSON;
        IF json_typeof(v_variantes) <> 'array' THEN
            v_variantes := '[]'::JSON;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_variantes := '[]'::JSON;
    END;

    BEGIN
        v_atributos_tmpl := p_atributos_template::TEXT::JSON;
        IF json_typeof(v_atributos_tmpl) <> 'array' THEN
            v_atributos_tmpl := '[]'::JSON;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_atributos_tmpl := '[]'::JSON;
    END;

    -- Validaciones
    IF TRIM(COALESCE(p_nombre, '')) = '' THEN
        RAISE EXCEPTION 'El nombre del producto es obligatorio';
    END IF;

    IF json_array_length(v_variantes) = 0 THEN
        RAISE EXCEPTION 'Debe incluir al menos una variante. Para producto simple usar fn_crear_producto_simple.';
    END IF;

    IF json_array_length(v_atributos_tmpl) = 0 THEN
        RAISE EXCEPTION 'Debe incluir al menos un tipo de atributo para el template.';
    END IF;

    -- 🔒 Multi-tenant: la categoría debe pertenecer al negocio activo
    IF p_categoria_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM categorias_productos
        WHERE id = p_categoria_id AND negocio_id = v_negocio_id
    ) THEN
        RAISE EXCEPTION 'La categoría no pertenece a este negocio';
    END IF;

    -- 1. Crear template (sin tiene_iva — la fuente de verdad es cada SKU en productos)
    v_template_id := gen_random_uuid();

    INSERT INTO producto_templates (
        id, negocio_id, nombre, categoria_id, tipo_venta, unidad_medida, imagen_url, activo
    ) VALUES (
        v_template_id, v_negocio_id,
        TRIM(p_nombre), p_categoria_id, p_tipo_venta, p_unidad_medida, p_imagen_url, TRUE
    );

    -- 2. Procesar atributos del template
    FOR v_atributo_entry IN
        SELECT value FROM json_array_elements(v_atributos_tmpl)
    LOOP
        v_atributo_nombre := UPPER(TRIM(v_atributo_entry->>'atributo_nombre'));

        -- Buscar o crear el atributo del negocio
        v_atributo_id := (SELECT id FROM atributos WHERE negocio_id = v_negocio_id AND nombre = v_atributo_nombre);
        IF v_atributo_id IS NULL THEN
            v_atributo_id := gen_random_uuid();
            INSERT INTO atributos (id, negocio_id, nombre)
            VALUES (v_atributo_id, v_negocio_id, v_atributo_nombre);
        END IF;

        -- Crear template_atributo
        v_ta_id := gen_random_uuid();
        INSERT INTO template_atributos (id, template_id, atributo_id)
        VALUES (v_ta_id, v_template_id, v_atributo_id);

        -- Vincular opciones al template_atributo
        FOR v_opcion_id_val IN
            SELECT value::text FROM json_array_elements_text(v_atributo_entry->'opcion_ids')
        LOOP
            v_opcion_id := v_opcion_id_val::UUID;
            -- 🔒 Multi-tenant: la opción debe pertenecer al negocio activo
            IF NOT EXISTS (
                SELECT 1 FROM atributo_opciones
                WHERE id = v_opcion_id AND negocio_id = v_negocio_id
            ) THEN
                RAISE EXCEPTION 'Una opción de atributo no pertenece a este negocio: %', v_opcion_id;
            END IF;
            INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
            VALUES (v_ta_id, v_opcion_id)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;

    -- 3. Crear SKUs
    FOR v_variante IN
        SELECT value FROM json_array_elements(v_variantes)
    LOOP
        v_producto_id := gen_random_uuid();

        INSERT INTO productos (
            id, negocio_id,
            producto_template_id,
            tiene_iva,
            nombre, precio_costo, precio_venta, stock_actual, stock_minimo,
            codigo_barras, imagen_url, activo
        ) VALUES (
            v_producto_id, v_negocio_id,
            v_template_id,
            p_tiene_iva,
            TRIM(v_variante->>'nombre'),
            (v_variante->>'precio_costo')::NUMERIC,
            (v_variante->>'precio_venta')::NUMERIC,
            COALESCE((v_variante->>'stock_actual')::NUMERIC, 0),
            COALESCE((v_variante->>'stock_minimo')::INTEGER, 5),
            NULLIF(TRIM(COALESCE(v_variante->>'codigo_barras', '')), ''),
            NULLIF(TRIM(COALESCE(v_variante->>'imagen_url', '')), ''),
            TRUE
        );

        -- Vincular atributos al SKU (producto_atributos)
        IF v_variante->'opcion_ids' IS NOT NULL AND json_array_length(v_variante->'opcion_ids') > 0 THEN
            FOR v_opcion_id_val IN
                SELECT value::text FROM json_array_elements_text(v_variante->'opcion_ids')
            LOOP
                v_opcion_id := v_opcion_id_val::UUID;
                INSERT INTO producto_atributos (producto_id, atributo_opcion_id)
                VALUES (v_producto_id, v_opcion_id)
                ON CONFLICT DO NOTHING;
            END LOOP;
        END IF;

        -- Presentaciones del SKU (si las tiene)
        IF v_variante->'presentaciones' IS NOT NULL AND json_array_length(v_variante->'presentaciones') > 0 THEN
            FOR v_pres IN
                SELECT value FROM json_array_elements(v_variante->'presentaciones')
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

        v_skus_creados := v_skus_creados + 1;
    END LOOP;

    RETURN json_build_object(
        'ok', TRUE,
        'template_id', v_template_id,
        'skus_creados', v_skus_creados
    );
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_crear_producto_con_variantes FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_crear_producto_con_variantes TO authenticated;

NOTIFY pgrst, 'reload schema';
