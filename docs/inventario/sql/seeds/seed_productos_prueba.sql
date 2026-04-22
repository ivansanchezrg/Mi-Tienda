-- ==========================================
-- SEED: Productos de prueba — Inventario (v11 - Implementacion actual)
-- ==========================================
-- Cubre los 4 flujos reales del modulo de inventario:
--
--   CASO 1: Producto simple           → fn_crear_producto_simple (sin presentaciones)
--   CASO 2: Producto con variantes    → fn_crear_producto_con_variantes
--   CASO 3: Producto con presentaciones → fn_crear_producto_simple (con presentaciones)
--   CASO 4: Variante con presentaciones → fn_crear_producto_con_variantes (SKU con presentaciones)
--
-- Casos de la vida real para un SaaS POS multi-tienda:
--   CASO 1: Agua embotellada — se vende unitaria, precio fijo
--   CASO 2: Tapioca — misma marca, distintos sabores y tamanios → variantes
--   CASO 3: Cigarro — suelto O cajetilla x10/x20 → presentaciones
--   CASO 4: Gaseosa — distintos tamanios (variantes) y cada uno
--            se puede vender suelto O en pack x6 → variante + presentacion
--
-- LIMPIEZA:
--   DELETE FROM producto_templates WHERE nombre IN ('TAPIOCA','GASEOSA COLA');
--   DELETE FROM productos WHERE nombre LIKE 'TEST-%' OR nombre = 'AGUA SIN GAS 500ML' OR nombre = 'CIGARRO MARLBORO';
--   DELETE FROM atributos WHERE nombre IN ('SABOR','TAMANIO');
--
-- NOTAS:
--   - Las funciones usan SELECT value FROM json_array_elements (no SELECT INTO)
--   - opcion_ids deben ser UUIDs reales: se crean primero y se usan en el mismo bloque
--   - precio_costo en presentaciones es el costo real del paquete, no la unidad
-- ==========================================


-- ══════════════════════════════════════════════════════
-- CASO 1 — Producto simple sin presentaciones
--
-- Escenario real SaaS: una bodega vende agua embotellada
-- unitaria. Sin variantes, sin packs. Flujo mas comun
-- en cualquier tienda de barrio: 95% de los productos
-- son exactamente esto.
-- ══════════════════════════════════════════════════════
SELECT public.fn_crear_producto_simple(
    p_nombre          := 'TEST-AGUA SIN GAS 500ML',
    p_categoria_id    := (SELECT id FROM categorias_productos WHERE LOWER(nombre) LIKE '%bebida%' LIMIT 1),
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


-- ══════════════════════════════════════════════════════
-- CASO 2 — Producto con variantes (sin presentaciones)
--
-- Escenario real SaaS: una distribuidora vende tapioca
-- en 3 sabores (FRESA, CHOCOLATE, VAINILLA) y 2 tamanios
-- (500G, 1KG) → 6 SKUs generados automaticamente.
-- Cada SKU tiene su propio precio y stock.
-- El template agrupa todo bajo "TAPIOCA".
-- ══════════════════════════════════════════════════════
DO $$
DECLARE
    -- Atributo: SABOR
    v_sabor_id       UUID;
    v_fresa_id       UUID;
    v_chocolate_id   UUID;
    v_vainilla_id    UUID;
    -- Atributo: TAMANIO
    v_tamanio_id     UUID;
    v_500g_id        UUID;
    v_1kg_id         UUID;
    v_result         JSON;
BEGIN
    -- Crear atributo SABOR si no existe
    v_sabor_id := (SELECT id FROM atributos WHERE nombre = 'SABOR');
    IF v_sabor_id IS NULL THEN
        INSERT INTO atributos (nombre) VALUES ('SABOR') RETURNING id INTO v_sabor_id;
    END IF;

    -- Opciones de SABOR
    INSERT INTO atributo_opciones (atributo_id, valor) VALUES (v_sabor_id, 'FRESA')
        ON CONFLICT (atributo_id, valor) DO NOTHING;
    v_fresa_id := (SELECT id FROM atributo_opciones WHERE atributo_id = v_sabor_id AND valor = 'FRESA');

    INSERT INTO atributo_opciones (atributo_id, valor) VALUES (v_sabor_id, 'CHOCOLATE')
        ON CONFLICT (atributo_id, valor) DO NOTHING;
    v_chocolate_id := (SELECT id FROM atributo_opciones WHERE atributo_id = v_sabor_id AND valor = 'CHOCOLATE');

    INSERT INTO atributo_opciones (atributo_id, valor) VALUES (v_sabor_id, 'VAINILLA')
        ON CONFLICT (atributo_id, valor) DO NOTHING;
    v_vainilla_id := (SELECT id FROM atributo_opciones WHERE atributo_id = v_sabor_id AND valor = 'VAINILLA');

    -- Crear atributo TAMANIO si no existe
    v_tamanio_id := (SELECT id FROM atributos WHERE nombre = 'TAMANIO');
    IF v_tamanio_id IS NULL THEN
        INSERT INTO atributos (nombre) VALUES ('TAMANIO') RETURNING id INTO v_tamanio_id;
    END IF;

    -- Opciones de TAMANIO
    INSERT INTO atributo_opciones (atributo_id, valor) VALUES (v_tamanio_id, '500G')
        ON CONFLICT (atributo_id, valor) DO NOTHING;
    v_500g_id := (SELECT id FROM atributo_opciones WHERE atributo_id = v_tamanio_id AND valor = '500G');

    INSERT INTO atributo_opciones (atributo_id, valor) VALUES (v_tamanio_id, '1KG')
        ON CONFLICT (atributo_id, valor) DO NOTHING;
    v_1kg_id := (SELECT id FROM atributo_opciones WHERE atributo_id = v_tamanio_id AND valor = '1KG');

    -- Crear template + 6 SKUs via la funcion
    v_result := public.fn_crear_producto_con_variantes(
        p_nombre           := 'TEST-TAPIOCA',
        p_categoria_id     := (SELECT id FROM categorias_productos WHERE LOWER(nombre) LIKE '%snack%' OR LOWER(nombre) LIKE '%abarrot%' LIMIT 1),
        p_tiene_iva        := TRUE,
        p_tipo_venta       := 'UNIDAD',
        p_unidad_medida    := 'und',
        p_atributos_template := json_build_array(
            json_build_object(
                'atributo_nombre', 'SABOR',
                'opcion_ids', json_build_array(v_fresa_id::text, v_chocolate_id::text, v_vainilla_id::text)
            ),
            json_build_object(
                'atributo_nombre', 'TAMANIO',
                'opcion_ids', json_build_array(v_500g_id::text, v_1kg_id::text)
            )
        ),
        p_variantes := json_build_array(
            -- FRESA 500G
            json_build_object(
                'nombre',        'TEST-TAPIOCA FRESA 500G',
                'precio_costo',  0.55,
                'precio_venta',  0.85,
                'stock_actual',  40,
                'stock_minimo',  10,
                'codigo_barras', 'TEST-P2-001',
                'opcion_ids',    json_build_array(v_fresa_id::text, v_500g_id::text),
                'presentaciones', '[]'::JSON
            ),
            -- FRESA 1KG
            json_build_object(
                'nombre',        'TEST-TAPIOCA FRESA 1KG',
                'precio_costo',  1.00,
                'precio_venta',  1.55,
                'stock_actual',  20,
                'stock_minimo',  5,
                'codigo_barras', 'TEST-P2-002',
                'opcion_ids',    json_build_array(v_fresa_id::text, v_1kg_id::text),
                'presentaciones', '[]'::JSON
            ),
            -- CHOCOLATE 500G
            json_build_object(
                'nombre',        'TEST-TAPIOCA CHOCOLATE 500G',
                'precio_costo',  0.55,
                'precio_venta',  0.85,
                'stock_actual',  35,
                'stock_minimo',  10,
                'codigo_barras', 'TEST-P2-003',
                'opcion_ids',    json_build_array(v_chocolate_id::text, v_500g_id::text),
                'presentaciones', '[]'::JSON
            ),
            -- CHOCOLATE 1KG
            json_build_object(
                'nombre',        'TEST-TAPIOCA CHOCOLATE 1KG',
                'precio_costo',  1.00,
                'precio_venta',  1.55,
                'stock_actual',  15,
                'stock_minimo',  5,
                'codigo_barras', 'TEST-P2-004',
                'opcion_ids',    json_build_array(v_chocolate_id::text, v_1kg_id::text),
                'presentaciones', '[]'::JSON
            ),
            -- VAINILLA 500G
            json_build_object(
                'nombre',        'TEST-TAPIOCA VAINILLA 500G',
                'precio_costo',  0.55,
                'precio_venta',  0.85,
                'stock_actual',  25,
                'stock_minimo',  10,
                'codigo_barras', 'TEST-P2-005',
                'opcion_ids',    json_build_array(v_vainilla_id::text, v_500g_id::text),
                'presentaciones', '[]'::JSON
            ),
            -- VAINILLA 1KG
            json_build_object(
                'nombre',        'TEST-TAPIOCA VAINILLA 1KG',
                'precio_costo',  1.00,
                'precio_venta',  1.55,
                'stock_actual',  10,
                'stock_minimo',  5,
                'codigo_barras', 'TEST-P2-006',
                'opcion_ids',    json_build_array(v_vainilla_id::text, v_1kg_id::text),
                'presentaciones', '[]'::JSON
            )
        )
    );

    RAISE NOTICE 'Caso 2 (variantes): %', v_result;
END $$;


-- ══════════════════════════════════════════════════════
-- CASO 3 — Producto simple CON presentaciones
--
-- Escenario real SaaS: un minimarket vende cigarros.
-- El producto base es el cigarro suelto ($0.25).
-- Ademas se puede vender en Cajetilla x10 ($2.30) y
-- Cajetilla x20 ($4.50). El stock siempre se descuenta
-- en unidades sueltas (stock del producto base).
-- Un solo producto, multiples formas de venta en el POS.
-- ══════════════════════════════════════════════════════
SELECT public.fn_crear_producto_simple(
    p_nombre          := 'TEST-CIGARRO MARLBORO',
    p_categoria_id    := (SELECT id FROM categorias_productos WHERE LOWER(nombre) LIKE '%snack%' OR LOWER(nombre) LIKE '%abarrot%' LIMIT 1),
    p_tiene_iva       := TRUE,
    p_tipo_venta      := 'UNIDAD',
    p_unidad_medida   := 'und',
    p_codigo_barras   := 'TEST-P3-000',
    p_precio_costo    := 0.15,
    p_precio_venta    := 0.25,
    p_stock_actual    := 200,
    p_stock_minimo    := 20,
    p_presentaciones  := json_build_array(
        -- Cajetilla x10: costo real del paquete = 0.15 * 10 = 1.50
        json_build_object(
            'nombre',            'CAJETILLA X10',
            'factor_conversion', 10,
            'precio_costo',      1.50,
            'precio_venta',      2.30,
            'codigo_barras',     'TEST-P3-010'
        ),
        -- Cajetilla x20: costo real del paquete = 0.15 * 20 = 3.00
        json_build_object(
            'nombre',            'CAJETILLA X20',
            'factor_conversion', 20,
            'precio_costo',      3.00,
            'precio_venta',      4.50,
            'codigo_barras',     'TEST-P3-020'
        )
    )::JSON
);


-- ══════════════════════════════════════════════════════
-- CASO 4 — Variantes CON presentaciones por SKU
--
-- Escenario real SaaS: una tienda vende Gaseosa Cola en
-- dos tamanios (330ML y 600ML). Cada tamanio es un SKU
-- independiente con su propio precio. Ademas, cada SKU
-- puede venderse suelto O en pack x6. Esto combina
-- variantes + presentaciones en la misma creacion.
--
-- Resultado en BD:
--   Template:  GASEOSA COLA
--   SKU 1:     GASEOSA COLA 330ML  → suelto + pack x6
--   SKU 2:     GASEOSA COLA 600ML  → suelto + pack x6
-- ══════════════════════════════════════════════════════
DO $$
DECLARE
    v_tamanio_id  UUID;
    v_330ml_id    UUID;
    v_600ml_id    UUID;
    v_result      JSON;
BEGIN
    -- Reusar o crear atributo TAMANIO
    v_tamanio_id := (SELECT id FROM atributos WHERE nombre = 'TAMANIO');
    IF v_tamanio_id IS NULL THEN
        INSERT INTO atributos (nombre) VALUES ('TAMANIO') RETURNING id INTO v_tamanio_id;
    END IF;

    -- Opciones de TAMANIO para esta gaseosa
    INSERT INTO atributo_opciones (atributo_id, valor) VALUES (v_tamanio_id, '330ML')
        ON CONFLICT (atributo_id, valor) DO NOTHING;
    v_330ml_id := (SELECT id FROM atributo_opciones WHERE atributo_id = v_tamanio_id AND valor = '330ML');

    INSERT INTO atributo_opciones (atributo_id, valor) VALUES (v_tamanio_id, '600ML')
        ON CONFLICT (atributo_id, valor) DO NOTHING;
    v_600ml_id := (SELECT id FROM atributo_opciones WHERE atributo_id = v_tamanio_id AND valor = '600ML');

    v_result := public.fn_crear_producto_con_variantes(
        p_nombre           := 'TEST-GASEOSA COLA',
        p_categoria_id     := (SELECT id FROM categorias_productos WHERE LOWER(nombre) LIKE '%bebida%' LIMIT 1),
        p_tiene_iva        := TRUE,
        p_tipo_venta       := 'UNIDAD',
        p_unidad_medida    := 'und',
        p_atributos_template := json_build_array(
            json_build_object(
                'atributo_nombre', 'TAMANIO',
                'opcion_ids', json_build_array(v_330ml_id::text, v_600ml_id::text)
            )
        ),
        p_variantes := json_build_array(
            -- SKU 330ML: suelto + pack x6
            json_build_object(
                'nombre',        'TEST-GASEOSA COLA 330ML',
                'precio_costo',  0.42,
                'precio_venta',  0.65,
                'stock_actual',  72,
                'stock_minimo',  12,
                'codigo_barras', 'TEST-P4-330',
                'opcion_ids',    json_build_array(v_330ml_id::text),
                'presentaciones', json_build_array(
                    json_build_object(
                        'nombre',            'PACK X6',
                        'factor_conversion', 6,
                        'precio_costo',      2.52,
                        'precio_venta',      3.60,
                        'codigo_barras',     'TEST-P4-330-P6'
                    )
                )
            ),
            -- SKU 600ML: suelto + pack x6
            json_build_object(
                'nombre',        'TEST-GASEOSA COLA 600ML',
                'precio_costo',  0.55,
                'precio_venta',  0.85,
                'stock_actual',  48,
                'stock_minimo',  12,
                'codigo_barras', 'TEST-P4-600',
                'opcion_ids',    json_build_array(v_600ml_id::text),
                'presentaciones', json_build_array(
                    json_build_object(
                        'nombre',            'PACK X6',
                        'factor_conversion', 6,
                        'precio_costo',      3.30,
                        'precio_venta',      4.80,
                        'codigo_barras',     'TEST-P4-600-P6'
                    )
                )
            )
        )
    );

    RAISE NOTICE 'Caso 4 (variantes + presentaciones): %', v_result;
END $$;


-- ══════════════════════════════════════════════════════
-- VERIFICACION — Cuantos productos/templates quedaron creados
-- ══════════════════════════════════════════════════════
SELECT
    p.nombre                                        AS producto,
    COALESCE(pt.nombre, '—')                        AS template,
    p.precio_costo                                  AS costo,
    p.precio_venta                                  AS venta,
    p.stock_actual                                  AS stock,
    COUNT(pp.id)                                    AS presentaciones
FROM productos p
LEFT JOIN producto_templates pt ON pt.id = p.producto_template_id
LEFT JOIN producto_presentaciones pp ON pp.producto_id = p.id
WHERE p.nombre LIKE 'TEST-%'
GROUP BY p.id, p.nombre, pt.nombre, p.precio_costo, p.precio_venta, p.stock_actual
ORDER BY pt.nombre NULLS LAST, p.nombre;
