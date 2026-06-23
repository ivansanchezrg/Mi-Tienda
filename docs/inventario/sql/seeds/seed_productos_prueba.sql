-- ==========================================
-- SEED: Productos de prueba — Inventario
-- Version: 2.1 (schema v11 — multi-tenant, UUID)
-- ==========================================
-- Cubre los 4 flujos reales del modulo de inventario:
--
--   CASO 1: Producto simple           → fn_crear_producto_simple (sin presentaciones)
--   CASO 2: Producto con variantes    → fn_crear_producto_con_variantes
--   CASO 3: Producto con presentaciones → fn_crear_producto_simple (con presentaciones)
--   CASO 4: Variante con presentaciones → fn_crear_producto_con_variantes (SKU con presentaciones)
--
-- COMO EJECUTAR:
--   1. Abrir Supabase SQL Editor
--   2. Reemplazar '<REEMPLAZAR-CON-NEGOCIO-ID>' con el UUID real del negocio (2 lugares: set_config + DO $$)
--   3. Ejecutar el bloque set_config PRIMERO (simula el JWT que leen las funciones SQL)
--   4. Ejecutar el bloque DO $$ en la misma sesion
--
-- POR QUE set_config:
--   Las funciones usan get_negocio_id() = auth.jwt()->'app_metadata'->>'negocio_id'.
--   El SQL Editor de Supabase no tiene JWT de usuario — set_config inyecta el claim
--   en la sesion actual para que auth.jwt() lo devuelva correctamente.
--
-- LIMPIEZA:
--   DELETE FROM producto_templates WHERE nombre IN ('TEST-TAPIOCA', 'TEST-GASEOSA COLA') AND negocio_id = '<tu-negocio-id>';
--   DELETE FROM productos WHERE nombre LIKE 'TEST-%' AND negocio_id = '<tu-negocio-id>';
--   DELETE FROM atributos WHERE nombre IN ('SABOR', 'TAMANIO') AND negocio_id = '<tu-negocio-id>';
-- ==========================================

-- ── PASO 1: Simular JWT con negocio_id (ejecutar antes del DO $$) ──
-- Reemplazar el UUID con el negocio real
SELECT set_config(
    'request.jwt.claims',
    json_build_object(
        'app_metadata', json_build_object(
            'negocio_id', '<REEMPLAZAR-CON-NEGOCIO-ID>',
            'rol',        'ADMIN'
        )
    )::text,
    true  -- true = solo esta sesion (se resetea al cerrar)
);

-- ── PASO 2: Seed de productos ──
DO $$
DECLARE
    -- ── CONFIGURACION: reemplazar con el UUID real del negocio ──
    v_negocio_id  UUID := '<REEMPLAZAR-CON-NEGOCIO-ID>';

    -- Variables compartidas
    v_cat_bebida  UUID;
    v_cat_snack   UUID;
    v_result      JSON;

    -- Atributos
    v_sabor_id      UUID;
    v_fresa_id      UUID;
    v_chocolate_id  UUID;
    v_vainilla_id   UUID;
    v_tamanio_id    UUID;
    v_500g_id       UUID;
    v_1kg_id        UUID;
    v_330ml_id      UUID;
    v_600ml_id      UUID;
BEGIN

    -- ── Categorias (buscar o usar la primera disponible del negocio) ──
    v_cat_bebida := (SELECT id FROM categorias_productos
                     WHERE negocio_id = v_negocio_id AND LOWER(nombre) LIKE '%bebida%' LIMIT 1);
    v_cat_bebida := COALESCE(v_cat_bebida,
                     (SELECT id FROM categorias_productos WHERE negocio_id = v_negocio_id LIMIT 1));

    v_cat_snack  := (SELECT id FROM categorias_productos
                     WHERE negocio_id = v_negocio_id
                       AND (LOWER(nombre) LIKE '%snack%' OR LOWER(nombre) LIKE '%abarrot%') LIMIT 1);
    v_cat_snack  := COALESCE(v_cat_snack, v_cat_bebida);

    IF v_cat_bebida IS NULL THEN
        RAISE EXCEPTION 'No hay categorias de productos para el negocio %. Ejecutar fn_completar_onboarding primero.', v_negocio_id;
    END IF;


    -- ══════════════════════════════════════════════════════
    -- CASO 1 — Producto simple sin presentaciones
    -- Escenario: agua embotellada unitaria. Flujo mas comun
    -- en cualquier tienda de barrio (95% de los productos).
    -- ══════════════════════════════════════════════════════
    v_result := public.fn_crear_producto_simple(
        p_nombre          := 'TEST-AGUA SIN GAS 500ML',
        p_categoria_id    := v_cat_bebida,
        p_tiene_iva       := FALSE,
        p_tipo_venta      := 'UNIDAD',
        p_unidad_medida   := 'und',
        p_codigo_barras   := 'TEST-P1-001',
        p_precio_costo    := 0.20,
        p_precio_venta    := 0.35,
        p_stock_actual    := 60,
        p_stock_minimo    := 12,
        p_presentaciones  := '[]'::JSON
    );
    RAISE NOTICE 'Caso 1 (simple): %', v_result;


    -- ══════════════════════════════════════════════════════
    -- CASO 2 — Producto con variantes (sin presentaciones)
    -- Escenario: tapioca en 3 sabores x 2 tamanios = 6 SKUs.
    -- ══════════════════════════════════════════════════════

    -- Atributo SABOR (con negocio_id)
    v_sabor_id := (SELECT id FROM atributos WHERE nombre = 'SABOR' AND negocio_id = v_negocio_id);
    IF v_sabor_id IS NULL THEN
        v_sabor_id := gen_random_uuid();
        INSERT INTO atributos (id, negocio_id, nombre) VALUES (v_sabor_id, v_negocio_id, 'SABOR');
    END IF;

    INSERT INTO atributo_opciones (negocio_id, atributo_id, valor) VALUES (v_negocio_id, v_sabor_id, 'FRESA')
        ON CONFLICT (atributo_id, valor) DO NOTHING;
    v_fresa_id := (SELECT id FROM atributo_opciones WHERE atributo_id = v_sabor_id AND valor = 'FRESA');

    INSERT INTO atributo_opciones (negocio_id, atributo_id, valor) VALUES (v_negocio_id, v_sabor_id, 'CHOCOLATE')
        ON CONFLICT (atributo_id, valor) DO NOTHING;
    v_chocolate_id := (SELECT id FROM atributo_opciones WHERE atributo_id = v_sabor_id AND valor = 'CHOCOLATE');

    INSERT INTO atributo_opciones (negocio_id, atributo_id, valor) VALUES (v_negocio_id, v_sabor_id, 'VAINILLA')
        ON CONFLICT (atributo_id, valor) DO NOTHING;
    v_vainilla_id := (SELECT id FROM atributo_opciones WHERE atributo_id = v_sabor_id AND valor = 'VAINILLA');

    -- Atributo TAMANIO (con negocio_id)
    v_tamanio_id := (SELECT id FROM atributos WHERE nombre = 'TAMANIO' AND negocio_id = v_negocio_id);
    IF v_tamanio_id IS NULL THEN
        v_tamanio_id := gen_random_uuid();
        INSERT INTO atributos (id, negocio_id, nombre) VALUES (v_tamanio_id, v_negocio_id, 'TAMANIO');
    END IF;

    INSERT INTO atributo_opciones (negocio_id, atributo_id, valor) VALUES (v_negocio_id, v_tamanio_id, '500G')
        ON CONFLICT (atributo_id, valor) DO NOTHING;
    v_500g_id := (SELECT id FROM atributo_opciones WHERE atributo_id = v_tamanio_id AND valor = '500G');

    INSERT INTO atributo_opciones (negocio_id, atributo_id, valor) VALUES (v_negocio_id, v_tamanio_id, '1KG')
        ON CONFLICT (atributo_id, valor) DO NOTHING;
    v_1kg_id := (SELECT id FROM atributo_opciones WHERE atributo_id = v_tamanio_id AND valor = '1KG');

    v_result := public.fn_crear_producto_con_variantes(
        p_nombre           := 'TEST-TAPIOCA',
        p_categoria_id     := v_cat_snack,
        p_tiene_iva        := TRUE,
        p_tipo_venta       := 'UNIDAD',
        p_unidad_medida    := 'und',
        p_atributos_template := json_build_array(
            json_build_object('atributo_nombre', 'SABOR',
                'opcion_ids', json_build_array(v_fresa_id::text, v_chocolate_id::text, v_vainilla_id::text)),
            json_build_object('atributo_nombre', 'TAMANIO',
                'opcion_ids', json_build_array(v_500g_id::text, v_1kg_id::text))
        ),
        p_variantes := json_build_array(
            json_build_object('nombre','TEST-TAPIOCA FRESA 500G','precio_costo',0.55,'precio_venta',0.85,
                'stock_actual',40,'stock_minimo',10,'codigo_barras','TEST-P2-001',
                'opcion_ids',json_build_array(v_fresa_id::text,v_500g_id::text),'presentaciones','[]'::JSON),
            json_build_object('nombre','TEST-TAPIOCA FRESA 1KG','precio_costo',1.00,'precio_venta',1.55,
                'stock_actual',20,'stock_minimo',5,'codigo_barras','TEST-P2-002',
                'opcion_ids',json_build_array(v_fresa_id::text,v_1kg_id::text),'presentaciones','[]'::JSON),
            json_build_object('nombre','TEST-TAPIOCA CHOCOLATE 500G','precio_costo',0.55,'precio_venta',0.85,
                'stock_actual',35,'stock_minimo',10,'codigo_barras','TEST-P2-003',
                'opcion_ids',json_build_array(v_chocolate_id::text,v_500g_id::text),'presentaciones','[]'::JSON),
            json_build_object('nombre','TEST-TAPIOCA CHOCOLATE 1KG','precio_costo',1.00,'precio_venta',1.55,
                'stock_actual',15,'stock_minimo',5,'codigo_barras','TEST-P2-004',
                'opcion_ids',json_build_array(v_chocolate_id::text,v_1kg_id::text),'presentaciones','[]'::JSON),
            json_build_object('nombre','TEST-TAPIOCA VAINILLA 500G','precio_costo',0.55,'precio_venta',0.85,
                'stock_actual',25,'stock_minimo',10,'codigo_barras','TEST-P2-005',
                'opcion_ids',json_build_array(v_vainilla_id::text,v_500g_id::text),'presentaciones','[]'::JSON),
            json_build_object('nombre','TEST-TAPIOCA VAINILLA 1KG','precio_costo',1.00,'precio_venta',1.55,
                'stock_actual',10,'stock_minimo',5,'codigo_barras','TEST-P2-006',
                'opcion_ids',json_build_array(v_vainilla_id::text,v_1kg_id::text),'presentaciones','[]'::JSON)
        )
    );
    RAISE NOTICE 'Caso 2 (variantes): %', v_result;


    -- ══════════════════════════════════════════════════════
    -- CASO 3 — Producto simple CON presentaciones
    -- Escenario: cigarro suelto + cajetilla x10 + cajetilla x20.
    -- Stock siempre en unidades sueltas.
    -- ══════════════════════════════════════════════════════
    v_result := public.fn_crear_producto_simple(
        p_nombre          := 'TEST-CIGARRO MARLBORO',
        p_categoria_id    := v_cat_snack,
        p_tiene_iva       := TRUE,
        p_tipo_venta      := 'UNIDAD',
        p_unidad_medida   := 'und',
        p_codigo_barras   := 'TEST-P3-000',
        p_precio_costo    := 0.15,
        p_precio_venta    := 0.25,
        p_stock_actual    := 200,
        p_stock_minimo    := 20,
        p_presentaciones  := json_build_array(
            json_build_object('nombre','CAJETILLA X10','factor_conversion',10,
                'precio_costo',1.50,'precio_venta',2.30,'codigo_barras','TEST-P3-010'),
            json_build_object('nombre','CAJETILLA X20','factor_conversion',20,
                'precio_costo',3.00,'precio_venta',4.50,'codigo_barras','TEST-P3-020')
        )::JSON
    );
    RAISE NOTICE 'Caso 3 (presentaciones): %', v_result;


    -- ══════════════════════════════════════════════════════
    -- CASO 4 — Variantes CON presentaciones por SKU
    -- Escenario: gaseosa en 330ML y 600ML, cada una suelto o pack x6.
    -- ══════════════════════════════════════════════════════

    -- Reusar TAMANIO ya creado (o crear si no existe, cubierto arriba)
    -- Opciones nuevas: 330ML y 600ML
    INSERT INTO atributo_opciones (negocio_id, atributo_id, valor) VALUES (v_negocio_id, v_tamanio_id, '330ML')
        ON CONFLICT (atributo_id, valor) DO NOTHING;
    v_330ml_id := (SELECT id FROM atributo_opciones WHERE atributo_id = v_tamanio_id AND valor = '330ML');

    INSERT INTO atributo_opciones (negocio_id, atributo_id, valor) VALUES (v_negocio_id, v_tamanio_id, '600ML')
        ON CONFLICT (atributo_id, valor) DO NOTHING;
    v_600ml_id := (SELECT id FROM atributo_opciones WHERE atributo_id = v_tamanio_id AND valor = '600ML');

    v_result := public.fn_crear_producto_con_variantes(
        p_nombre           := 'TEST-GASEOSA COLA',
        p_categoria_id     := v_cat_bebida,
        p_tiene_iva        := TRUE,
        p_tipo_venta       := 'UNIDAD',
        p_unidad_medida    := 'und',
        p_atributos_template := json_build_array(
            json_build_object('atributo_nombre','TAMANIO',
                'opcion_ids',json_build_array(v_330ml_id::text,v_600ml_id::text))
        ),
        p_variantes := json_build_array(
            json_build_object('nombre','TEST-GASEOSA COLA 330ML','precio_costo',0.42,'precio_venta',0.65,
                'stock_actual',72,'stock_minimo',12,'codigo_barras','TEST-P4-330',
                'opcion_ids',json_build_array(v_330ml_id::text),
                'presentaciones',json_build_array(
                    json_build_object('nombre','PACK X6','factor_conversion',6,
                        'precio_costo',2.52,'precio_venta',3.60,'codigo_barras','TEST-P4-330-P6')
                )),
            json_build_object('nombre','TEST-GASEOSA COLA 600ML','precio_costo',0.55,'precio_venta',0.85,
                'stock_actual',48,'stock_minimo',12,'codigo_barras','TEST-P4-600',
                'opcion_ids',json_build_array(v_600ml_id::text),
                'presentaciones',json_build_array(
                    json_build_object('nombre','PACK X6','factor_conversion',6,
                        'precio_costo',3.30,'precio_venta',4.80,'codigo_barras','TEST-P4-600-P6')
                ))
        )
    );
    RAISE NOTICE 'Caso 4 (variantes + presentaciones): %', v_result;

END $$;


-- ══════════════════════════════════════════════════════
-- VERIFICACION — ejecutar por separado reemplazando el negocio_id
-- ══════════════════════════════════════════════════════
-- SELECT
--     p.nombre                                        AS producto,
--     COALESCE(pt.nombre, '—')                        AS template,
--     p.precio_costo                                  AS costo,
--     p.precio_venta                                  AS venta,
--     p.stock_actual                                  AS stock,
--     COUNT(pp.id)                                    AS presentaciones
-- FROM productos p
-- LEFT JOIN producto_templates pt ON pt.id = p.producto_template_id
-- LEFT JOIN producto_presentaciones pp ON pp.producto_id = p.id
-- WHERE p.nombre LIKE 'TEST-%'
--   AND p.negocio_id = '<REEMPLAZAR-CON-NEGOCIO-ID>'
-- GROUP BY p.id, p.nombre, pt.nombre, p.precio_costo, p.precio_venta, p.stock_actual
-- ORDER BY pt.nombre NULLS LAST, p.nombre;
