-- ============================================================================
-- SEED MASIVO DE PRODUCTOS (~500) — datos realistas de tienda ecuatoriana
-- ============================================================================
-- Objetivo: poblar un negocio con volumen real para probar rendimiento y UX de
-- inventario, POS, kardex, filtros "Reponer"/"Desactivados", presentaciones y
-- variantes. NO toca ventas, cajas ni turnos.
--
-- QUÉ CREA (aprox):
--   · 13 categorías de tienda de barrio
--   · ~285 productos simples UNIDAD (marcas reales EC, precios de mercado)
--   · ~46  productos PESO (frutas/verduras/carnes/granel, stock decimal en lb)
--   · ~12  productos DESACTIVADOS (activo = false) → prueba filtro Desactivados
--   · ~18  productos base con ~35 presentaciones (cigarrillos, cerveza, huevos,
--          gaseosas six-pack, papel higiénico, atún, pilas...)
--   · 12 templates de variantes (~110 SKUs): ropa TALLA×COLOR, batidos
--     SABOR×TAMAÑO, esmaltes COLOR, velas AROMA...
--   · Escenarios operativos: ~8% agotados (stock 0) y ~12% con stock <= mínimo
--     → prueba badges y filtro "Reponer"
--   · 1 registro de kardex COMPRA "Stock inicial" por producto con stock > 0
--
-- CÓMO EJECUTAR:
--   1. El slug ya está fijado a 'tienda-prueba' (negocio de pruebas). Si quieres
--      apuntar a otro negocio, cambia el valor en la línea
--      v_negocio_id := (SELECT id FROM negocios WHERE slug = '...');
--      Nota: `slug` es el identificador de texto del negocio (ej. 'tienda-prueba'),
--      NO el UUID de `id` — si pasas un UUID ahí, el SELECT no encuentra nada.
--   2. Pegar TODO el archivo en Supabase SQL Editor y ejecutar UNA sola vez.
--      (El editor corre como postgres → bypasea RLS; todo el bloque es atómico:
--       si algo falla, no se inserta nada.)
--
-- POR QUÉ INSERTs DIRECTOS Y NO LAS RPCs (fn_crear_producto_simple, etc.):
--   Las RPCs leen get_negocio_id() del JWT — en el SQL Editor no hay JWT.
--   Por eso el negocio_id va explícito. Los triggers de sincronización de
--   codigos_barras y de herencia de template SÍ se disparan igual.
--
-- MARCADORES PARA LIMPIEZA (ver bloque comentado al final):
--   · productos simples/base:  codigo_barras LIKE '7861234%'
--   · presentaciones:          codigo_barras LIKE '7864321%'
--   · SKUs de variantes:       codigo_barras LIKE '2098%'
--   · kardex:                  observaciones = 'Stock inicial — seed de prueba'
-- ============================================================================

DO $$
DECLARE
    v_negocio_id     UUID;

    -- Categorías
    v_cat_bebidas    UUID;
    v_cat_snacks     UUID;
    v_cat_lacteos    UUID;
    v_cat_panaderia  UUID;
    v_cat_abarrotes  UUID;
    v_cat_limpieza   UUID;
    v_cat_aseo       UUID;
    v_cat_bazar      UUID;
    v_cat_mascotas   UUID;
    v_cat_licores    UUID;
    v_cat_frutas     UUID;
    v_cat_carnes     UUID;
    v_cat_ropa       UUID;

    -- Atributos
    v_attr_talla     UUID;
    v_attr_color     UUID;
    v_attr_sabor     UUID;
    v_attr_tamano    UUID;
    v_attr_aroma     UUID;

    -- Producto base temporal (presentaciones)
    v_prod           UUID;

    -- Template temporal (variantes)
    v_tmpl           UUID;
    v_ta1            UUID;   -- template_atributo fila 1
    v_ta2            UUID;   -- template_atributo fila 2
BEGIN
    -- ────────────────────────────────────────────────────────────────────
    -- 0. NEGOCIO DESTINO — ⚠️ CAMBIAR EL SLUG
    -- ────────────────────────────────────────────────────────────────────
    v_negocio_id := (SELECT id FROM negocios WHERE slug = 'tienda-prueba');
    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'Negocio no encontrado. Edita el slug en la linea "v_negocio_id := ..." (slugs disponibles: %)',
            (SELECT string_agg(slug, ', ') FROM negocios);
    END IF;

    -- Guard anti doble ejecución (los códigos chocarían con UNIQUE de codigos_barras)
    IF EXISTS (SELECT 1 FROM productos WHERE negocio_id = v_negocio_id AND codigo_barras LIKE '7861234%') THEN
        RAISE EXCEPTION 'El seed ya fue ejecutado en este negocio. Usa el script de limpieza del final del archivo antes de re-ejecutar.';
    END IF;

    -- ────────────────────────────────────────────────────────────────────
    -- 1. CATEGORÍAS (idempotente: reusa si ya existen)
    -- ────────────────────────────────────────────────────────────────────
    INSERT INTO categorias_productos (negocio_id, nombre) VALUES
        (v_negocio_id, 'Bebidas'),
        (v_negocio_id, 'Snacks y Golosinas'),
        (v_negocio_id, 'Lácteos y Huevos'),
        (v_negocio_id, 'Panadería'),
        (v_negocio_id, 'Abarrotes'),
        (v_negocio_id, 'Limpieza Hogar'),
        (v_negocio_id, 'Aseo Personal'),
        (v_negocio_id, 'Bazar y Papelería'),
        (v_negocio_id, 'Mascotas'),
        (v_negocio_id, 'Licores y Cigarrillos'),
        (v_negocio_id, 'Frutas y Verduras'),
        (v_negocio_id, 'Carnes y Embutidos'),
        (v_negocio_id, 'Ropa y Accesorios')
    ON CONFLICT (negocio_id, nombre) DO NOTHING;

    v_cat_bebidas   := (SELECT id FROM categorias_productos WHERE negocio_id = v_negocio_id AND nombre = 'Bebidas');
    v_cat_snacks    := (SELECT id FROM categorias_productos WHERE negocio_id = v_negocio_id AND nombre = 'Snacks y Golosinas');
    v_cat_lacteos   := (SELECT id FROM categorias_productos WHERE negocio_id = v_negocio_id AND nombre = 'Lácteos y Huevos');
    v_cat_panaderia := (SELECT id FROM categorias_productos WHERE negocio_id = v_negocio_id AND nombre = 'Panadería');
    v_cat_abarrotes := (SELECT id FROM categorias_productos WHERE negocio_id = v_negocio_id AND nombre = 'Abarrotes');
    v_cat_limpieza  := (SELECT id FROM categorias_productos WHERE negocio_id = v_negocio_id AND nombre = 'Limpieza Hogar');
    v_cat_aseo      := (SELECT id FROM categorias_productos WHERE negocio_id = v_negocio_id AND nombre = 'Aseo Personal');
    v_cat_bazar     := (SELECT id FROM categorias_productos WHERE negocio_id = v_negocio_id AND nombre = 'Bazar y Papelería');
    v_cat_mascotas  := (SELECT id FROM categorias_productos WHERE negocio_id = v_negocio_id AND nombre = 'Mascotas');
    v_cat_licores   := (SELECT id FROM categorias_productos WHERE negocio_id = v_negocio_id AND nombre = 'Licores y Cigarrillos');
    v_cat_frutas    := (SELECT id FROM categorias_productos WHERE negocio_id = v_negocio_id AND nombre = 'Frutas y Verduras');
    v_cat_carnes    := (SELECT id FROM categorias_productos WHERE negocio_id = v_negocio_id AND nombre = 'Carnes y Embutidos');
    v_cat_ropa      := (SELECT id FROM categorias_productos WHERE negocio_id = v_negocio_id AND nombre = 'Ropa y Accesorios');

    -- ────────────────────────────────────────────────────────────────────
    -- 2. PRODUCTOS SIMPLES — UNIDAD
    --    Cada bloque usa un rango de código propio: '7861234' + 6 dígitos.
    --    stock 0 = agotado · stock <= minimo = "Reponer" · iva=false = IVA 0%
    -- ────────────────────────────────────────────────────────────────────

    -- ── 2.1 BEBIDAS (rango 001xxx) ──
    INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    SELECT v_negocio_id, v_cat_bebidas, '7861234' || LPAD((1000 + ROW_NUMBER() OVER ())::TEXT, 6, '0'),
           t.nombre, t.costo, t.venta, t.stock, t.minimo, t.iva
    FROM (VALUES
        ('Coca-Cola 500ml',                 0.55, 0.75,  48, 12, TRUE),
        ('Coca-Cola 1.35L',                 1.05, 1.50,  24,  6, TRUE),
        ('Coca-Cola 3L',                    2.10, 2.75,  10,  4, TRUE),
        ('Fioravanti Fresa 500ml',          0.50, 0.70,  30,  8, TRUE),
        ('Fioravanti Manzana 1.35L',        1.00, 1.40,  12,  6, TRUE),
        ('Sprite 500ml',                    0.55, 0.75,  36,  8, TRUE),
        ('Fanta Naranja 500ml',             0.55, 0.75,   6,  8, TRUE),
        ('Inca Kola 500ml',                 0.60, 0.85,   0,  6, TRUE),
        ('Pepsi 500ml',                     0.50, 0.70,  20,  6, TRUE),
        ('Big Cola 3L',                     1.40, 1.90,   8,  4, TRUE),
        ('Guitig 500ml',                    0.48, 0.65,  40, 10, TRUE),
        ('Guitig Esencias Limón 500ml',     0.55, 0.75,  18,  6, TRUE),
        ('Agua Dasani 600ml',               0.35, 0.50,  60, 15, TRUE),
        ('Agua Tesalia 500ml',              0.30, 0.45,  55, 15, TRUE),
        ('Agua Vivant 6L',                  1.30, 1.80,   9,  4, TRUE),
        ('Cifrut Citrus Punch 500ml',       0.40, 0.60,  25,  8, TRUE),
        ('Cifrut Fruit Punch 1.5L',         0.85, 1.20,  14,  5, TRUE),
        ('Del Valle Durazno 400ml',         0.55, 0.80,  16,  6, TRUE),
        ('Natura Naranja 1L',               0.90, 1.25,  12,  5, TRUE),
        ('Pulp Mango 400ml',                0.50, 0.75,   4,  6, TRUE),
        ('Tampico Citrus 500ml',            0.45, 0.65,  22,  8, TRUE),
        ('Pony Malta 330ml',                0.50, 0.70,  28,  8, TRUE),
        ('Gatorade Tropical 500ml',         0.85, 1.25,  15,  6, TRUE),
        ('Powerade Frutas 500ml',           0.80, 1.15,  13,  6, TRUE),
        ('Vive100 365ml',                   0.55, 0.80,  35, 10, TRUE),
        ('V220 Energizante 365ml',          0.50, 0.75,  30, 10, TRUE),
        ('Red Bull 250ml',                  1.60, 2.25,   8,  4, TRUE),
        ('Monster Energy 473ml',            1.90, 2.60,   6,  4, TRUE),
        ('220V Ponche 365ml',               0.55, 0.80,   2,  8, TRUE),
        ('Té Fuze Limón 550ml',             0.60, 0.90,  18,  6, TRUE),
        ('Té Fuze Durazno 550ml',           0.60, 0.90,  17,  6, TRUE),
        ('Avena Polaca 250ml',              0.40, 0.60,  20,  8, TRUE),
        ('Jugo Deli Durazno 1L',            0.95, 1.35,  10,  5, TRUE),
        ('Limonada Cifrut 3L',              1.35, 1.85,   7,  4, TRUE),
        ('Café frío Starbucks 281ml',       2.10, 2.90,   5,  3, TRUE),
        ('Yogurt bebible Toni Frutilla 200ml', 0.55, 0.80, 26, 8, TRUE),
        ('Néctar Sunny Mango 237ml',        0.30, 0.45,  30, 10, TRUE),
        ('Malta Regional 330ml',            0.45, 0.65,  12,  6, TRUE),
        ('Soda Sprite Zero 500ml',          0.55, 0.78,   9,  5, TRUE),
        ('Agua saborizada Cielo 625ml',     0.45, 0.65,  11,  5, TRUE)
    ) AS t(nombre, costo, venta, stock, minimo, iva);

    -- ── 2.2 SNACKS Y GOLOSINAS (rango 002xxx) ──
    INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    SELECT v_negocio_id, v_cat_snacks, '7861234' || LPAD((2000 + ROW_NUMBER() OVER ())::TEXT, 6, '0'),
           t.nombre, t.costo, t.venta, t.stock, t.minimo, t.iva
    FROM (VALUES
        ('Doritos Mega Queso 42g',          0.38, 0.55,  40, 12, TRUE),
        ('Doritos Flamin Hot 42g',          0.38, 0.55,  35, 12, TRUE),
        ('K-Chitos Picantes 29g',           0.25, 0.35,  50, 15, TRUE),
        ('Papas Ruffles Natural 42g',       0.38, 0.55,  38, 12, TRUE),
        ('Papas Ruffles Crema y Cebolla 42g', 0.38, 0.55, 30, 12, TRUE),
        ('Papas Lays Clásicas 39g',         0.38, 0.55,  33, 10, TRUE),
        ('De Todito Mix 45g',               0.42, 0.60,  28, 10, TRUE),
        ('Tostitos Salsa Verde 42g',        0.40, 0.58,   8, 10, TRUE),
        ('Cheetos Horneados 28g',           0.28, 0.40,  45, 15, TRUE),
        ('Platanitos Tortolines 45g',       0.40, 0.60,  25,  8, TRUE),
        ('Yuquitas Tortolines 45g',         0.40, 0.60,  20,  8, TRUE),
        ('Chifles picantes Banchis 45g',    0.38, 0.55,  22,  8, TRUE),
        ('Maní salado La Universal 30g',    0.28, 0.40,  30, 10, TRUE),
        ('Maní dulce confitado 30g',        0.28, 0.40,  26, 10, TRUE),
        ('Habas saladas 40g',               0.30, 0.45,  15,  6, TRUE),
        ('Cueritos de cerdo 25g',           0.45, 0.65,   0,  6, TRUE),
        ('Galletas Oreo 36g',               0.35, 0.50,  48, 15, TRUE),
        ('Galletas Amor Vainilla 100g',     0.55, 0.80,  20,  8, TRUE),
        ('Galletas Festival Fresa 50g',     0.30, 0.45,  36, 12, TRUE),
        ('Galletas Ricas 77g',              0.40, 0.60,  24,  8, TRUE),
        ('Galletas Club Social 26g',        0.28, 0.40,  30, 10, TRUE),
        ('Galletas María La Universal 100g', 0.45, 0.65, 18,  8, TRUE),
        ('Wafer Amor Chocolate 100g',       0.55, 0.80,  16,  6, TRUE),
        ('Chocolate Manicho 28g',           0.42, 0.60,  60, 20, TRUE),
        ('Chocolate Manicho Mini 8g',       0.14, 0.20,  90, 30, TRUE),
        ('Huevitos La Universal 20g',       0.30, 0.45,  40, 12, TRUE),
        ('Chocolate Galak 25g',             0.50, 0.75,  14,  6, TRUE),
        ('Chocolate Jet 12g',               0.20, 0.30,  55, 20, TRUE),
        ('Bombones Plop surtidos',          0.04, 0.06, 200, 50, TRUE),
        ('Chupete Plop Fresa',              0.05, 0.10, 180, 50, TRUE),
        ('Caramelos Menta unidad',          0.02, 0.05, 300, 80, TRUE),
        ('Chicle Trident Menta 8.5g',       0.30, 0.45,  42, 15, TRUE),
        ('Chicle Agogo bolita',             0.03, 0.05, 250, 60, TRUE),
        ('Halls Mentol unidad',             0.07, 0.10, 120, 40, TRUE),
        ('Halls Cereza sobre 25g',          0.55, 0.80,  18,  8, TRUE),
        ('Marshmallows Guandy 100g',        0.60, 0.90,  10,  5, TRUE),
        ('Gomitas Mogul 80g',               0.65, 0.95,  12,  6, TRUE),
        ('Barra cereal Quaker 25g',         0.35, 0.50,  20,  8, TRUE),
        ('Cake Bony Vainilla 45g',          0.30, 0.45,  25, 10, TRUE),
        ('Cake Bony Chocolate 45g',         0.30, 0.45,   5, 10, TRUE),
        ('Gelatoni vasito',                 0.25, 0.40,  30, 10, TRUE),
        ('Bolo Popeye unidad',              0.08, 0.15, 100, 30, TRUE),
        ('Salchipapas fundita 30g',         0.25, 0.40,   3,  8, TRUE),
        ('Canguil dulce funda 60g',         0.35, 0.55,  14,  6, TRUE),
        ('Turrón de maní 25g',              0.20, 0.35,  22,  8, TRUE),
        ('Chocolisto sachet 18g',           0.22, 0.35,  35, 12, TRUE),
        ('Galleta Coco Nestlé 60g',         0.42, 0.62,  16,  6, TRUE),
        ('Pringles Original 37g',           0.95, 1.40,   7,  4, TRUE)
    ) AS t(nombre, costo, venta, stock, minimo, iva);

    -- ── 2.3 LÁCTEOS Y HUEVOS (rango 003xxx) — canasta básica: varios IVA 0% ──
    INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    SELECT v_negocio_id, v_cat_lacteos, '7861234' || LPAD((3000 + ROW_NUMBER() OVER ())::TEXT, 6, '0'),
           t.nombre, t.costo, t.venta, t.stock, t.minimo, t.iva
    FROM (VALUES
        ('Leche Vita Entera 1L',            0.95, 1.15,  30, 10, FALSE),
        ('Leche Vita Deslactosada 1L',      1.10, 1.35,  15,  6, FALSE),
        ('Leche La Lechera Entera 1L',      1.00, 1.20,  20,  8, FALSE),
        ('Leche Nutri Semidescremada 1L',   0.95, 1.15,  12,  6, FALSE),
        ('Leche en polvo Nido 120g',        1.60, 2.10,  10,  4, FALSE),
        ('Leche condensada La Lechera 100g', 0.85, 1.20, 14,  6, TRUE),
        ('Yogurt Toni Durazno 1L',          2.20, 2.90,   8,  4, TRUE),
        ('Yogurt Toni Frutilla 1L',         2.20, 2.90,   6,  4, TRUE),
        ('Yogurt Regeneris Mora 950g',      2.35, 3.10,   5,  3, TRUE),
        ('Yogurt griego Toni 150g',         0.85, 1.20,  10,  5, TRUE),
        ('Queso fresco El Ranchito 500g',   2.60, 3.25,  12,  5, FALSE),
        ('Queso mozzarella Kiosko 250g',    2.10, 2.75,   6,  3, FALSE),
        ('Queso criollo de mesa 450g',      2.40, 3.00,   4,  4, FALSE),
        ('Quesillo fundita 250g',           1.20, 1.60,   0,  4, FALSE),
        ('Mantequilla Bonella 250g',        1.35, 1.75,  10,  4, TRUE),
        ('Margarina Klar 250g',             0.95, 1.30,  14,  5, TRUE),
        ('Crema de leche Toni 200ml',       0.95, 1.30,   9,  4, TRUE),
        ('Avena con leche Toni 250ml',      0.55, 0.80,  20,  8, TRUE),
        ('Bebida Chocolatada Toni 200ml',   0.50, 0.75,  25,  8, TRUE),
        ('Leche saborizada fresa 200ml',    0.45, 0.65,  16,  6, TRUE),
        ('Mermelada Facundo Mora 300g',     1.25, 1.70,   8,  4, TRUE),
        ('Dulce de leche La Vaquita 250g',  1.40, 1.90,   5,  3, TRUE),
        ('Queso parmesano rallado 40g',     0.90, 1.30,   7,  3, TRUE),
        ('Leche de almendras 946ml',        2.80, 3.60,   3,  2, TRUE)
    ) AS t(nombre, costo, venta, stock, minimo, iva);

    -- ── 2.4 PANADERÍA (rango 004xxx) — IVA 0% en pan común ──
    INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    SELECT v_negocio_id, v_cat_panaderia, '7861234' || LPAD((4000 + ROW_NUMBER() OVER ())::TEXT, 6, '0'),
           t.nombre, t.costo, t.venta, t.stock, t.minimo, t.iva
    FROM (VALUES
        ('Pan enrollado unidad',            0.10, 0.15,  60, 20, FALSE),
        ('Pan de dulce unidad',             0.10, 0.15,  45, 20, FALSE),
        ('Pan integral unidad',             0.12, 0.18,  30, 15, FALSE),
        ('Pan de yema unidad',              0.12, 0.18,  25, 15, FALSE),
        ('Empanada de queso',               0.30, 0.50,  18, 10, FALSE),
        ('Pan Supan molde blanco 550g',     1.45, 1.90,  10,  4, FALSE),
        ('Pan Supan integral 550g',         1.60, 2.10,   6,  4, FALSE),
        ('Pan de hot dog Supan x8',         1.10, 1.50,   8,  4, FALSE),
        ('Pan de hamburguesa Supan x6',     1.15, 1.55,   7,  4, FALSE),
        ('Tostadas Grille 120g',            0.90, 1.30,   9,  4, TRUE),
        ('Cake naranja Supan 230g',         1.30, 1.80,   5,  3, TRUE),
        ('Bizcochos de sal funda x6',       1.00, 1.40,   4,  4, FALSE),
        ('Roscas de manteca funda x8',      0.90, 1.25,   0,  4, FALSE),
        ('Orejas de hojaldre unidad',       0.20, 0.35,  15,  8, FALSE),
        ('Pan baguette unidad',             0.60, 0.90,   3,  4, FALSE)
    ) AS t(nombre, costo, venta, stock, minimo, iva);

    -- ── 2.5 ABARROTES (rango 005xxx) — canasta básica: varios IVA 0% ──
    INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    SELECT v_negocio_id, v_cat_abarrotes, '7861234' || LPAD((5000 + ROW_NUMBER() OVER ())::TEXT, 6, '0'),
           t.nombre, t.costo, t.venta, t.stock, t.minimo, t.iva
    FROM (VALUES
        ('Arroz Flor funda 2kg',            2.30, 2.80,  20,  8, FALSE),
        ('Arroz Osito envejecido 2kg',      2.50, 3.10,  12,  6, FALSE),
        ('Azúcar San Carlos 2kg',           2.10, 2.60,  18,  8, FALSE),
        ('Azúcar morena Valdez 1kg',        1.15, 1.50,  10,  5, FALSE),
        ('Sal Crisal 1kg',                  0.45, 0.65,  25, 10, FALSE),
        ('Aceite La Favorita 1L',           2.60, 3.20,  15,  6, FALSE),
        ('Aceite El Cocinero 900ml',        2.30, 2.90,  12,  6, FALSE),
        ('Aceite Girasol 1L',               3.10, 3.90,   6,  3, FALSE),
        ('Manteca Tres Chanchitos 425g',    1.30, 1.75,   8,  4, TRUE),
        ('Harina Ya 1kg',                   1.20, 1.60,  14,  6, FALSE),
        ('Harina de trigo Santa Lucía 1kg', 1.00, 1.40,  10,  5, FALSE),
        ('Maicena Iris 200g',               0.70, 1.00,  12,  5, TRUE),
        ('Fideo Oriental tallarín 400g',    0.85, 1.20,  22,  8, FALSE),
        ('Fideo Oriental lazo 400g',        0.85, 1.20,  18,  8, FALSE),
        ('Fideo Paca sopa 200g',            0.40, 0.60,  30, 10, FALSE),
        ('Fideo Sumesa rapidito 85g',       0.30, 0.45,  40, 15, FALSE),
        ('Atún Real lomitos en aceite 180g', 1.25, 1.65, 30, 10, FALSE),
        ('Atún Van Camps agua 184g',        1.40, 1.85,  16,  8, FALSE),
        ('Sardina Real salsa tomate 425g',  1.55, 2.05,  12,  6, FALSE),
        ('Lenteja funda 500g',              0.90, 1.25,  15,  6, FALSE),
        ('Fréjol rojo funda 500g',          1.10, 1.50,  12,  6, FALSE),
        ('Arveja verde partida 500g',       0.85, 1.20,  10,  5, FALSE),
        ('Avena Quaker 500g',               1.15, 1.55,  14,  6, FALSE),
        ('Café Buendía sobre 10g',          0.30, 0.45,  60, 20, TRUE),
        ('Café Nescafé Tradición 50g',      2.05, 2.70,  10,  4, TRUE),
        ('Café Sí Café 170g',               3.30, 4.20,   5,  3, TRUE),
        ('Cocoa Ricacao 200g',              1.30, 1.75,   9,  4, TRUE),
        ('Chocolate en polvo Nesquik 200g', 2.20, 2.90,   6,  3, TRUE),
        ('Azúcar Stevia x50 sobres',        2.40, 3.20,   4,  2, TRUE),
        ('Salsa de tomate Los Andes 380g',  1.05, 1.45,  14,  6, TRUE),
        ('Mayonesa Maggi 220g',             1.15, 1.55,  12,  5, TRUE),
        ('Mostaza Gustadina 200g',          0.85, 1.20,   8,  4, TRUE),
        ('Salsa china La Oriental 150ml',   0.75, 1.10,  10,  4, TRUE),
        ('Ají Tabasco criollo 90ml',        1.20, 1.65,   5,  3, TRUE),
        ('Vinagre blanco Snob 500ml',       0.80, 1.15,   7,  3, TRUE),
        ('Cubos Maggi gallina x8',          0.65, 0.95,  25, 10, TRUE),
        ('Sazonador Ranchero 50g',          0.45, 0.70,  20,  8, TRUE),
        ('Comino molido sobre 25g',         0.35, 0.55,  18,  8, TRUE),
        ('Orégano sobre 10g',               0.25, 0.40,  15,  6, TRUE),
        ('Canela en rama 20g',              0.40, 0.65,  12,  5, TRUE),
        ('Gelatina Royal Fresa 200g',       0.85, 1.20,  10,  5, TRUE),
        ('Polvo de hornear Royal 100g',     0.75, 1.10,   8,  4, TRUE),
        ('Esencia de vainilla 60ml',        0.55, 0.85,   9,  4, TRUE),
        ('Leche de coco lata 400ml',        1.60, 2.15,   4,  2, TRUE),
        ('Panela molida funda 500g',        0.85, 1.20,   0,  5, FALSE),
        ('Mote cocido funda 500g',          0.90, 1.30,   6,  4, FALSE),
        ('Chochos pelados funda 400g',      1.20, 1.65,   3,  4, FALSE),
        ('Maíz canguil funda 500g',         0.70, 1.00,  11,  5, FALSE),
        ('Machica funda 500g',              0.75, 1.10,   5,  3, FALSE),
        ('Pinol funda 400g',                0.85, 1.25,   4,  3, FALSE)
    ) AS t(nombre, costo, venta, stock, minimo, iva);

    -- ── 2.6 LIMPIEZA HOGAR (rango 006xxx) ──
    INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    SELECT v_negocio_id, v_cat_limpieza, '7861234' || LPAD((6000 + ROW_NUMBER() OVER ())::TEXT, 6, '0'),
           t.nombre, t.costo, t.venta, t.stock, t.minimo, t.iva
    FROM (VALUES
        ('Detergente Deja Floral 1kg',      2.15, 2.80,  15,  6, TRUE),
        ('Detergente Deja 360g',            0.95, 1.35,  25, 10, TRUE),
        ('Detergente Ciclón 1kg',           1.95, 2.60,  10,  5, TRUE),
        ('Jabón de lavar Lavatodo x1',      0.55, 0.80,  40, 15, TRUE),
        ('Jabón de lavar Perla bebé',       0.65, 0.95,  20,  8, TRUE),
        ('Lavavajilla Axion crema 450g',    1.35, 1.85,  12,  5, TRUE),
        ('Lavavajilla Lava 500g',           1.10, 1.55,  14,  6, TRUE),
        ('Cloro Clorox 500ml',              0.75, 1.10,  18,  8, TRUE),
        ('Cloro Clorox 1L',                 1.25, 1.70,  10,  5, TRUE),
        ('Desinfectante Fabuloso Lavanda 500ml', 1.05, 1.50, 12, 5, TRUE),
        ('Desinfectante Kalipto 500ml',     1.15, 1.60,   8,  4, TRUE),
        ('Ambiental Glade Lavanda 360ml',   2.40, 3.20,   6,  3, TRUE),
        ('Insecticida Raid 360ml',          2.90, 3.80,   5,  3, TRUE),
        ('Fundas de basura 10 unid grandes', 0.85, 1.25, 20,  8, TRUE),
        ('Fundas de basura 20 unid pequeñas', 0.70, 1.05, 22, 8, TRUE),
        ('Esponja mixta Estrella',          0.30, 0.50,  30, 10, TRUE),
        ('Estropajo de acero x3',           0.45, 0.70,  18,  8, TRUE),
        ('Guantes de caucho talla M',       0.90, 1.35,   8,  4, TRUE),
        ('Escoba plástica suave',           1.90, 2.60,   6,  3, TRUE),
        ('Trapeador de tiras',              2.10, 2.90,   5,  3, TRUE),
        ('Recogedor de basura',             1.20, 1.75,   4,  2, TRUE),
        ('Paño absorbente multiusos x3',    1.10, 1.60,  10,  5, TRUE),
        ('Limpiavidrios Windex 500ml',      1.95, 2.60,   0,  3, TRUE),
        ('Cera para pisos roja 450ml',      1.60, 2.20,   3,  3, TRUE),
        ('Detergente líquido Ariel 800ml',  3.10, 4.00,   7,  3, TRUE),
        ('Suavizante Suavitel 850ml',       2.05, 2.75,   9,  4, TRUE),
        ('Bolsa de fósforos El Sol x10',    0.35, 0.55,  25, 10, TRUE),
        ('Velas blancas x6',                0.65, 0.95,  14,  6, TRUE)
    ) AS t(nombre, costo, venta, stock, minimo, iva);

    -- ── 2.7 ASEO PERSONAL (rango 007xxx) ──
    INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    SELECT v_negocio_id, v_cat_aseo, '7861234' || LPAD((7000 + ROW_NUMBER() OVER ())::TEXT, 6, '0'),
           t.nombre, t.costo, t.venta, t.stock, t.minimo, t.iva
    FROM (VALUES
        ('Pasta dental Colgate Triple 75ml', 1.30, 1.80, 20,  8, TRUE),
        ('Pasta dental Fortident 100ml',    1.05, 1.50,  15,  6, TRUE),
        ('Cepillo dental Colgate Premier',  0.85, 1.25,  18,  8, TRUE),
        ('Enjuague Listerine 180ml',        2.30, 3.10,   5,  3, TRUE),
        ('Jabón Protex Avena 110g',         0.85, 1.20,  30, 10, TRUE),
        ('Jabón Palmolive 110g',            0.75, 1.10,  25, 10, TRUE),
        ('Jabón Rexona 110g',               0.80, 1.15,  20,  8, TRUE),
        ('Jabón líquido Ballerina 750ml',   2.20, 2.95,   6,  3, TRUE),
        ('Shampoo H&S sachet 10ml',         0.22, 0.35, 100, 30, TRUE),
        ('Shampoo Sedal sachet 10ml',       0.20, 0.30,  90, 30, TRUE),
        ('Shampoo Savital 550ml',           3.40, 4.40,   6,  3, TRUE),
        ('Acondicionador Sedal 340ml',      2.60, 3.40,   5,  3, TRUE),
        ('Desodorante Rexona barra 45g',    2.15, 2.90,  12,  5, TRUE),
        ('Desodorante AXE aerosol 150ml',   2.90, 3.80,   8,  4, TRUE),
        ('Desodorante Lady Speed Stick 45g', 2.20, 2.95, 10,  4, TRUE),
        ('Talco Mexana 150g',               1.60, 2.20,   7,  3, TRUE),
        ('Crema Nivea lata 60ml',           1.45, 2.00,   9,  4, TRUE),
        ('Protector solar sachet 10ml',     0.45, 0.70,  30, 10, TRUE),
        ('Papel higiénico Familia unidad',  0.30, 0.45,  80, 25, TRUE),
        ('Papel higiénico Scott unidad',    0.28, 0.40,  70, 25, TRUE),
        ('Toallas Nosotras Normal x10',     1.40, 1.90,  15,  6, TRUE),
        ('Toallas Nosotras Invisible x10',  1.60, 2.15,  12,  5, TRUE),
        ('Protectores diarios Nosotras x15', 1.20, 1.65,  10,  5, TRUE),
        ('Pañales Panolini M x10',          2.60, 3.40,   8,  4, TRUE),
        ('Pañales Pañalín G x10',           2.75, 3.60,   6,  3, TRUE),
        ('Pañitos húmedos Angelino x50',    1.55, 2.10,   9,  4, TRUE),
        ('Máquina de afeitar Prestobarba x1', 0.75, 1.10, 24, 10, TRUE),
        ('Máquina BIC Comfort x1',          0.60, 0.90,  28, 10, TRUE),
        ('Algodón Familia 50g',             0.80, 1.15,  10,  4, TRUE),
        ('Curitas Curaplast x10',           0.45, 0.70,  20,  8, TRUE),
        ('Alcohol antiséptico 250ml',       0.95, 1.35,  12,  5, TRUE),
        ('Agua oxigenada 120ml',            0.55, 0.85,   8,  4, TRUE),
        ('Hisopos cotonetes x100',          0.85, 1.25,   7,  4, TRUE),
        ('Peinilla plástica',               0.35, 0.60,  15,  6, TRUE),
        ('Gel para cabello Ego 240g',       1.85, 2.50,   0,  4, TRUE)
    ) AS t(nombre, costo, venta, stock, minimo, iva);

    -- ── 2.8 BAZAR Y PAPELERÍA (rango 008xxx) ──
    INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    SELECT v_negocio_id, v_cat_bazar, '7861234' || LPAD((8000 + ROW_NUMBER() OVER ())::TEXT, 6, '0'),
           t.nombre, t.costo, t.venta, t.stock, t.minimo, t.iva
    FROM (VALUES
        ('Cuaderno universitario 100h',     1.20, 1.70,  20,  8, TRUE),
        ('Cuaderno pequeño 50h',            0.55, 0.85,  25, 10, TRUE),
        ('Esfero BIC azul',                 0.25, 0.40,  60, 20, TRUE),
        ('Esfero BIC negro',                0.25, 0.40,  50, 20, TRUE),
        ('Esfero BIC rojo',                 0.25, 0.40,  30, 15, TRUE),
        ('Lápiz Mongol HB',                 0.30, 0.50,  40, 15, TRUE),
        ('Borrador Pelikan blanco',         0.20, 0.35,  35, 12, TRUE),
        ('Sacapuntas metálico',             0.25, 0.40,  25, 10, TRUE),
        ('Regla 30cm plástica',             0.35, 0.55,  15,  6, TRUE),
        ('Goma en barra 21g',               0.65, 0.95,  18,  8, TRUE),
        ('Cinta scotch 18mm',               0.45, 0.70,  20,  8, TRUE),
        ('Marcador permanente negro',       0.60, 0.90,  14,  6, TRUE),
        ('Resaltador amarillo',             0.55, 0.85,  12,  5, TRUE),
        ('Papel bond A4 x100',              1.10, 1.60,   8,  4, TRUE),
        ('Cartulina blanca A3',             0.15, 0.25,  30, 10, TRUE),
        ('Tijeras escolares',               0.75, 1.15,  10,  4, TRUE),
        ('Pilas AA Panasonic par',          0.90, 1.35,  25, 10, TRUE),
        ('Pilas AAA Panasonic par',         0.90, 1.35,  20,  8, TRUE),
        ('Foco LED 9W',                     1.30, 1.90,  15,  6, TRUE),
        ('Foco LED 12W',                    1.60, 2.30,  10,  5, TRUE),
        ('Cargador USB genérico',           2.20, 3.20,   6,  3, TRUE),
        ('Cable USB tipo C 1m',             1.40, 2.10,   8,  4, TRUE),
        ('Audífonos económicos',            1.60, 2.50,   5,  3, TRUE),
        ('Encendedor BIC pequeño',          0.60, 0.90,  30, 10, TRUE),
        ('Paraguas plegable',               3.50, 5.00,   0,  2, TRUE)
    ) AS t(nombre, costo, venta, stock, minimo, iva);

    -- ── 2.9 MASCOTAS (rango 009xxx) ──
    INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    SELECT v_negocio_id, v_cat_mascotas, '7861234' || LPAD((9000 + ROW_NUMBER() OVER ())::TEXT, 6, '0'),
           t.nombre, t.costo, t.venta, t.stock, t.minimo, t.iva
    FROM (VALUES
        ('Balanceado Buen Can adulto 2kg',  3.40, 4.40,   8,  4, TRUE),
        ('Balanceado Buen Can cachorro 1kg', 2.10, 2.80,  6,  3, TRUE),
        ('Balanceado Pro-Can carne 500g',   1.20, 1.70,  15,  6, TRUE),
        ('Balanceado Mimaskot gato 500g',   1.35, 1.85,  10,  5, TRUE),
        ('Lata Pedigree adulto 340g',       1.50, 2.05,   7,  4, TRUE),
        ('Snack para perro huesitos x5',    0.85, 1.25,  12,  5, TRUE),
        ('Arena para gato 2kg',             2.20, 3.00,   4,  2, TRUE),
        ('Shampoo antipulgas 250ml',        2.60, 3.50,   3,  2, TRUE),
        ('Collar antipulgas perro',         1.80, 2.60,   5,  3, TRUE),
        ('Plato plástico para mascota',     1.10, 1.65,   6,  3, TRUE)
    ) AS t(nombre, costo, venta, stock, minimo, iva);

    -- ── 2.10 LICORES (rango 010xxx) — cigarrillos van aparte con presentaciones ──
    INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    SELECT v_negocio_id, v_cat_licores, '7861234' || LPAD((10000 + ROW_NUMBER() OVER ())::TEXT, 6, '0'),
           t.nombre, t.costo, t.venta, t.stock, t.minimo, t.iva
    FROM (VALUES
        ('Zhumir Pink 750ml',               6.50, 8.50,   6,  3, TRUE),
        ('Zhumir Durazno 750ml',            6.50, 8.50,   5,  3, TRUE),
        ('Norteño 750ml',                   4.80, 6.50,   8,  4, TRUE),
        ('Antioqueño 375ml',                5.20, 7.00,   4,  2, TRUE),
        ('Ron Abuelo añejo 750ml',         12.50, 16.00,  3,  2, TRUE),
        ('Vino Boones Fresa 750ml',         4.20, 5.80,   6,  3, TRUE),
        ('Vino tinto Clos 1L',              3.80, 5.20,   5,  3, TRUE),
        ('Whisky Something Special 375ml',  9.80, 12.80,  2,  2, TRUE),
        ('Vodka Switch Frutas 375ml',       4.50, 6.20,   7,  3, TRUE),
        ('Punta pura caña 500ml',           3.20, 4.50,   0,  3, TRUE),
        ('Cerveza Corona 355ml',            1.35, 1.90,  24,  8, TRUE),
        ('Cerveza Club Verde 550ml',        1.20, 1.70,  30, 10, TRUE),
        ('Smirnoff Ice 350ml',              1.60, 2.25,  12,  5, TRUE),
        ('Cerveza Budweiser lata 355ml',    1.10, 1.55,  18,  6, TRUE)
    ) AS t(nombre, costo, venta, stock, minimo, iva);

    -- ────────────────────────────────────────────────────────────────────
    -- 3. PRODUCTOS PESO — stock decimal en libras (rango 011xxx-013xxx)
    -- ────────────────────────────────────────────────────────────────────

    -- ── 3.1 FRUTAS Y VERDURAS (IVA 0%) ──
    INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva, tipo_venta, unidad_medida)
    SELECT v_negocio_id, v_cat_frutas, '7861234' || LPAD((11000 + ROW_NUMBER() OVER ())::TEXT, 6, '0'),
           t.nombre, t.costo, t.venta, t.stock, t.minimo, FALSE, 'PESO', 'lb'
    FROM (VALUES
        ('Tomate riñón',        0.35, 0.60,  25.5,  8),
        ('Cebolla paiteña',     0.30, 0.55,  18.0,  6),
        ('Cebolla blanca',      0.35, 0.60,  10.5,  5),
        ('Papa chola',          0.25, 0.45,  80.0, 25),
        ('Papa super chola',    0.30, 0.50,  45.0, 15),
        ('Zanahoria',           0.25, 0.45,  15.0,  6),
        ('Pimiento verde',      0.40, 0.70,   8.5,  4),
        ('Pepinillo',           0.30, 0.55,   6.0,  4),
        ('Brócoli',             0.45, 0.75,   5.5,  3),
        ('Limón sutil',         0.50, 0.80,  12.0,  5),
        ('Naranja valencia',    0.25, 0.45,  30.0, 10),
        ('Mandarina',           0.35, 0.60,  14.0,  6),
        ('Guineo seda',         0.20, 0.35,  40.0, 15),
        ('Plátano verde',       0.22, 0.40,  35.0, 12),
        ('Plátano maduro',      0.22, 0.40,  20.0, 10),
        ('Manzana roja importada', 0.65, 1.00, 12.5, 5),
        ('Pera importada',      0.70, 1.10,   4.0,  4),
        ('Uva negra',           1.10, 1.60,   6.5,  3),
        ('Sandía',              0.20, 0.35,  50.0, 15),
        ('Papaya nacional',     0.30, 0.50,  18.0,  8),
        ('Piña golden',         0.35, 0.60,  22.0,  8),
        ('Mora de castilla',    0.90, 1.40,   0.0,  4)
    ) AS t(nombre, costo, venta, stock, minimo);

    -- ── 3.2 CARNES Y EMBUTIDOS (IVA 0% carnes frescas) ──
    INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva, tipo_venta, unidad_medida)
    SELECT v_negocio_id, v_cat_carnes, '7861234' || LPAD((12000 + ROW_NUMBER() OVER ())::TEXT, 6, '0'),
           t.nombre, t.costo, t.venta, t.stock, t.minimo, t.iva, 'PESO', 'lb'
    FROM (VALUES
        ('Pollo entero',            1.15, 1.55,  35.0, 12, FALSE),
        ('Presas de pollo surtidas', 1.25, 1.70, 22.5,  8, FALSE),
        ('Pechuga de pollo',        1.55, 2.10,  15.0,  6, FALSE),
        ('Alitas de pollo',         1.30, 1.80,  10.0,  5, FALSE),
        ('Carne molida de res',     1.90, 2.60,  12.0,  5, FALSE),
        ('Carne de res para asado', 2.20, 3.00,   8.5,  4, FALSE),
        ('Chuleta de cerdo',        2.10, 2.85,   9.0,  4, FALSE),
        ('Costilla de cerdo',       1.95, 2.65,   6.5,  3, FALSE),
        ('Salchicha de pollo Plumrose', 1.60, 2.20, 7.0, 3, TRUE),
        ('Mortadela taco Don Diego', 1.40, 1.95,  5.5,  3, TRUE),
        ('Jamón sanduchero Plumrose', 2.30, 3.10,  3.0,  3, TRUE),
        ('Camarón pomada',          2.80, 3.80,   0.0,  4, FALSE)
    ) AS t(nombre, costo, venta, stock, minimo, iva);

    -- ── 3.3 GRANEL (Abarrotes al peso, IVA 0%) ──
    INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva, tipo_venta, unidad_medida)
    SELECT v_negocio_id, v_cat_abarrotes, '7861234' || LPAD((13000 + ROW_NUMBER() OVER ())::TEXT, 6, '0'),
           t.nombre, t.costo, t.venta, t.stock, t.minimo, FALSE, 'PESO', 'lb'
    FROM (VALUES
        ('Arroz al granel',         0.45, 0.60, 200.0, 50),
        ('Azúcar al granel',        0.42, 0.58, 150.0, 40),
        ('Lenteja al granel',       0.80, 1.10,  40.0, 12),
        ('Fréjol canario granel',   1.00, 1.40,  30.0, 10),
        ('Arveja seca granel',      0.75, 1.05,  25.0,  8),
        ('Maíz para tostado granel', 0.65, 0.95, 28.0, 10),
        ('Avena a granel',          0.55, 0.80,  20.0,  8),
        ('Harina de maíz granel',   0.60, 0.85,  15.0,  6),
        ('Sal en grano granel',     0.20, 0.35,  60.0, 15),
        ('Panela en bloque granel', 0.55, 0.80,  10.0,  6),
        ('Maní crudo granel',       1.20, 1.70,   5.0,  4),
        ('Quinua granel',           1.40, 1.95,   3.5,  4)
    ) AS t(nombre, costo, venta, stock, minimo);

    -- ────────────────────────────────────────────────────────────────────
    -- 4. PRODUCTOS DESACTIVADOS (activo = false) — prueba filtro Desactivados
    --    (rango 014xxx)
    -- ────────────────────────────────────────────────────────────────────
    INSERT INTO productos (negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva, activo)
    SELECT v_negocio_id, t.cat, '7861234' || LPAD((14000 + ROW_NUMBER() OVER ())::TEXT, 6, '0'),
           t.nombre, t.costo, t.venta, 0, 5, TRUE, FALSE
    FROM (VALUES
        (v_cat_bebidas,  'Quintuples Uva 500ml (descontinuado)',    0.45, 0.65),
        (v_cat_bebidas,  'Tropical 400ml vidrio (descontinuado)',   0.40, 0.60),
        (v_cat_snacks,   'Papas Sarita picante (descontinuado)',    0.30, 0.45),
        (v_cat_snacks,   'Chocolate Bonice barra (descontinuado)',  0.25, 0.40),
        (v_cat_abarrotes,'Aceite Palma de Oro 1L (proveedor caído)', 2.20, 2.80),
        (v_cat_abarrotes,'Café Colcafé 85g (rotación nula)',        2.40, 3.10),
        (v_cat_limpieza, 'Detergente Omo 400g (descontinuado)',     1.05, 1.45),
        (v_cat_aseo,     'Shampoo Konzil sachet (descontinuado)',   0.20, 0.30),
        (v_cat_aseo,     'Jabón Rosas y Almendras (descontinuado)', 0.60, 0.90),
        (v_cat_bazar,    'Cassette virgen 60min (obsoleto)',        0.80, 1.20),
        (v_cat_bazar,    'CD-R x1 (obsoleto)',                      0.35, 0.55),
        (v_cat_mascotas, 'Balanceado Dog Chow 1kg (rotación nula)', 2.60, 3.40)
    ) AS t(cat, nombre, costo, venta);

    -- ────────────────────────────────────────────────────────────────────
    -- 5. PRODUCTOS CON PRESENTACIONES
    --    El stock vive en el producto base (unidad); cada presentación tiene
    --    factor_conversion, precios propios y código de barras propio
    --    (prefijo '7864321'). Casos reales de tienda.
    -- ────────────────────────────────────────────────────────────────────

    -- 5.1 Cigarrillo Líder (suelto / media / cajetilla)
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_licores, '7861234015001', 'Cigarrillo Líder unidad', 0.25, 0.35, 400, 100, TRUE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Media cajetilla x10', 10, 2.50, 3.25, '7864321000011'),
        (v_negocio_id, v_prod, 'Cajetilla x20',       20, 5.00, 6.25, '7864321000012');

    -- 5.2 Cigarrillo Marlboro Rojo
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_licores, '7861234015002', 'Cigarrillo Marlboro unidad', 0.35, 0.50, 200, 60, TRUE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Cajetilla x20', 20, 7.00, 9.00, '7864321000021');

    -- 5.3 Cerveza Pilsener 600ml (unidad / six pack / jaba)
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_licores, '7861234015003', 'Cerveza Pilsener 600ml', 1.10, 1.50, 96, 24, TRUE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Six pack x6', 6, 6.60,  8.50, '7864321000031'),
        (v_negocio_id, v_prod, 'Jaba x12',   12, 13.20, 16.50, '7864321000032');

    -- 5.4 Cerveza Pilsener Light lata (unidad / six pack)
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_licores, '7861234015004', 'Pilsener Light lata 330ml', 0.85, 1.15, 72, 24, TRUE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Six pack x6', 6, 5.10, 6.50, '7864321000041');

    -- 5.5 Huevos (unidad / cubeta 15 / cubeta 30) — IVA 0%
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_lacteos, '7861234015005', 'Huevo de gallina unidad', 0.12, 0.17, 300, 90, FALSE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Cubeta x15', 15, 1.80, 2.40, '7864321000051'),
        (v_negocio_id, v_prod, 'Cubeta x30', 30, 3.60, 4.60, '7864321000052');

    -- 5.6 Coca-Cola mini 235ml (unidad / paquete x12)
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_bebidas, '7861234015006', 'Coca-Cola mini 235ml', 0.32, 0.45, 60, 24, TRUE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Paquete x12', 12, 3.84, 5.00, '7864321000061');

    -- 5.7 Agua Cielo 625ml (unidad / paquete x15)
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_bebidas, '7861234015007', 'Agua Cielo 625ml', 0.28, 0.40, 90, 30, TRUE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Paquete x15', 15, 4.20, 5.50, '7864321000071');

    -- 5.8 Papel higiénico Familia (unidad / x4 / x12)
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_aseo, '7861234015008', 'Papel higiénico Familia Acolchado unidad', 0.32, 0.45, 120, 36, TRUE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Paquete x4',   4, 1.28, 1.70, '7864321000081'),
        (v_negocio_id, v_prod, 'Paquete x12', 12, 3.84, 4.90, '7864321000082');

    -- 5.9 Atún Real (unidad / pack x3)
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_abarrotes, '7861234015009', 'Atún Real 80g', 0.65, 0.90, 60, 18, FALSE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Tripack x3', 3, 1.95, 2.55, '7864321000091');

    -- 5.10 Yogurt Toni mini (unidad / six pack)
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_lacteos, '7861234015010', 'Yogurt Toni mini 100g', 0.35, 0.50, 48, 18, TRUE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Six pack x6', 6, 2.10, 2.80, '7864321000101');

    -- 5.11 Gelatina Toni (unidad / pack x4)
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_lacteos, '7861234015011', 'Gelatina Toni 200g', 0.40, 0.60, 40, 12, TRUE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Pack x4', 4, 1.60, 2.20, '7864321000111');

    -- 5.12 Pilas AA (par ya existe arriba; aquí unidad / blister x4)
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_bazar, '7861234015012', 'Pila AA Energizer unidad', 0.50, 0.75, 40, 12, TRUE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Blister x4', 4, 2.00, 2.70, '7864321000121');

    -- 5.13 Funda de leche Rey Leche 1L (unidad / pack x6) — IVA 0%
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_lacteos, '7861234015013', 'Leche Rey Leche funda 1L', 0.90, 1.10, 36, 12, FALSE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Pack x6', 6, 5.40, 6.40, '7864321000131');

    -- 5.14 Cerveza Club dorada lata (unidad / six pack)
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_licores, '7861234015014', 'Cerveza Club lata 355ml', 1.00, 1.40, 48, 18, TRUE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Six pack x6', 6, 6.00, 7.80, '7864321000141');

    -- 5.15 Cuchara desechable (unidad / paquete x25)
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_bazar, '7861234015015', 'Cuchara desechable unidad', 0.02, 0.05, 500, 100, TRUE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Paquete x25', 25, 0.50, 0.90, '7864321000151');

    -- 5.16 Vaso desechable 7oz (unidad / paquete x50)
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_bazar, '7861234015016', 'Vaso desechable 7oz unidad', 0.02, 0.04, 800, 150, TRUE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Paquete x50', 50, 1.00, 1.60, '7864321000161');

    -- 5.17 Cigarrillo LM (suelto / cajetilla) — CON STOCK BAJO (prueba Reponer en base con presentaciones)
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_licores, '7861234015017', 'Cigarrillo LM unidad', 0.28, 0.40, 35, 60, TRUE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Cajetilla x20', 20, 5.60, 7.20, '7864321000171');

    -- 5.18 Pan de agua (unidad / funda x10) — AGOTADO (prueba agotado en base con presentaciones)
    v_prod := uuid_generate_v4();
    INSERT INTO productos (id, negocio_id, categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
    VALUES (v_prod, v_negocio_id, v_cat_panaderia, '7861234015018', 'Pan de agua unidad', 0.09, 0.14, 0, 30, FALSE);
    INSERT INTO producto_presentaciones (negocio_id, producto_id, nombre, factor_conversion, precio_costo, precio_venta, codigo_barras) VALUES
        (v_negocio_id, v_prod, 'Funda x10', 10, 0.90, 1.30, '7864321000181');

    -- ────────────────────────────────────────────────────────────────────
    -- 6. ATRIBUTOS Y OPCIONES (para variantes) — MAYÚSCULAS por CHECK
    -- ────────────────────────────────────────────────────────────────────
    INSERT INTO atributos (negocio_id, nombre) VALUES
        (v_negocio_id, 'TALLA'),
        (v_negocio_id, 'COLOR'),
        (v_negocio_id, 'SABOR'),
        (v_negocio_id, 'TAMAÑO'),
        (v_negocio_id, 'AROMA')
    ON CONFLICT (negocio_id, nombre) DO NOTHING;

    v_attr_talla  := (SELECT id FROM atributos WHERE negocio_id = v_negocio_id AND nombre = 'TALLA');
    v_attr_color  := (SELECT id FROM atributos WHERE negocio_id = v_negocio_id AND nombre = 'COLOR');
    v_attr_sabor  := (SELECT id FROM atributos WHERE negocio_id = v_negocio_id AND nombre = 'SABOR');
    v_attr_tamano := (SELECT id FROM atributos WHERE negocio_id = v_negocio_id AND nombre = 'TAMAÑO');
    v_attr_aroma  := (SELECT id FROM atributos WHERE negocio_id = v_negocio_id AND nombre = 'AROMA');

    INSERT INTO atributo_opciones (negocio_id, atributo_id, valor) VALUES
        (v_negocio_id, v_attr_talla,  'S'), (v_negocio_id, v_attr_talla, 'M'),
        (v_negocio_id, v_attr_talla,  'L'), (v_negocio_id, v_attr_talla, 'XL'),
        (v_negocio_id, v_attr_talla,  '35-38'), (v_negocio_id, v_attr_talla, '39-42'), (v_negocio_id, v_attr_talla, '43-46'),
        (v_negocio_id, v_attr_color,  'NEGRO'), (v_negocio_id, v_attr_color, 'BLANCO'),
        (v_negocio_id, v_attr_color,  'AZUL'),  (v_negocio_id, v_attr_color, 'ROJO'),
        (v_negocio_id, v_attr_color,  'GRIS'),  (v_negocio_id, v_attr_color, 'VERDE'),
        (v_negocio_id, v_attr_color,  'ROSADO'),(v_negocio_id, v_attr_color, 'MORADO'),
        (v_negocio_id, v_attr_color,  'CELESTE'),(v_negocio_id, v_attr_color, 'AMARILLO'),
        (v_negocio_id, v_attr_sabor,  'FRESA'), (v_negocio_id, v_attr_sabor, 'MORA'),
        (v_negocio_id, v_attr_sabor,  'MANGO'), (v_negocio_id, v_attr_sabor, 'GUANÁBANA'),
        (v_negocio_id, v_attr_sabor,  'COCO'),  (v_negocio_id, v_attr_sabor, 'CHOCOLATE'),
        (v_negocio_id, v_attr_sabor,  'VAINILLA'), (v_negocio_id, v_attr_sabor, 'MARACUYÁ'),
        (v_negocio_id, v_attr_tamano, 'PEQUEÑO'), (v_negocio_id, v_attr_tamano, 'GRANDE'),
        (v_negocio_id, v_attr_aroma,  'LAVANDA'), (v_negocio_id, v_attr_aroma, 'CANELA'),
        (v_negocio_id, v_attr_aroma,  'VAINILLA'), (v_negocio_id, v_attr_aroma, 'CÍTRICOS'),
        (v_negocio_id, v_attr_aroma,  'COCO'), (v_negocio_id, v_attr_aroma, 'EUCALIPTO')
    ON CONFLICT (atributo_id, valor) DO NOTHING;

    -- ────────────────────────────────────────────────────────────────────
    -- 7. PRODUCTOS CON VARIANTES (templates + SKUs generados)
    --    SKUs con campos heredados NULL (chk_herencia_template).
    --    Stock pseudo-aleatorio determinista: incluye 0 y bajos.
    --    Códigos: '2098' + 9 dígitos (rango interno GS1 '20').
    -- ────────────────────────────────────────────────────────────────────

    -- 7.1 CAMISETA BÁSICA — TALLA(S,M,L,XL) × COLOR(NEGRO,BLANCO,AZUL) = 12 SKUs
    v_tmpl := uuid_generate_v4();
    INSERT INTO producto_templates (id, negocio_id, nombre, categoria_id) VALUES (v_tmpl, v_negocio_id, 'CAMISETA BÁSICA', v_cat_ropa);
    v_ta1 := uuid_generate_v4();
    v_ta2 := uuid_generate_v4();
    INSERT INTO template_atributos (id, template_id, atributo_id) VALUES (v_ta1, v_tmpl, v_attr_talla), (v_ta2, v_tmpl, v_attr_color);
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta1, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_talla AND o.valor IN ('S','M','L','XL');
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta2, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_color AND o.valor IN ('NEGRO','BLANCO','AZUL');

    WITH combos AS (
        SELECT uuid_generate_v4() AS prod_id,
               t.id AS op_talla, c.id AS op_color,
               'CAMISETA BÁSICA ' || c.valor || ' ' || t.valor AS nombre,
               CASE t.valor WHEN 'XL' THEN 5.00 ELSE 4.50 END AS costo,
               CASE t.valor WHEN 'XL' THEN 7.50 ELSE 6.50 END AS venta,
               ((hashtext('CAM' || t.valor || c.valor) % 20 + 20) % 20) AS stock,
               ROW_NUMBER() OVER () AS rn
        FROM atributo_opciones t, atributo_opciones c
        WHERE t.atributo_id = v_attr_talla AND t.valor IN ('S','M','L','XL')
          AND c.atributo_id = v_attr_color AND c.valor IN ('NEGRO','BLANCO','AZUL')
    ), ins AS (
        INSERT INTO productos (id, negocio_id, producto_template_id, categoria_id, tipo_venta, unidad_medida,
                               codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
        SELECT prod_id, v_negocio_id, v_tmpl, NULL, NULL, NULL,
               '2098' || LPAD((100000 + rn)::TEXT, 9, '0'), nombre, costo, venta, stock, 3, TRUE
        FROM combos RETURNING id
    )
    INSERT INTO producto_atributos (producto_id, atributo_opcion_id)
    SELECT prod_id, op FROM combos CROSS JOIN LATERAL (VALUES (op_talla), (op_color)) v(op);

    -- 7.2 CAMISETA POLO — TALLA(4) × COLOR(NEGRO,BLANCO,GRIS,AZUL) = 16 SKUs
    v_tmpl := uuid_generate_v4();
    INSERT INTO producto_templates (id, negocio_id, nombre, categoria_id) VALUES (v_tmpl, v_negocio_id, 'CAMISETA POLO', v_cat_ropa);
    v_ta1 := uuid_generate_v4(); v_ta2 := uuid_generate_v4();
    INSERT INTO template_atributos (id, template_id, atributo_id) VALUES (v_ta1, v_tmpl, v_attr_talla), (v_ta2, v_tmpl, v_attr_color);
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta1, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_talla AND o.valor IN ('S','M','L','XL');
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta2, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_color AND o.valor IN ('NEGRO','BLANCO','GRIS','AZUL');

    WITH combos AS (
        SELECT uuid_generate_v4() AS prod_id, t.id AS op1, c.id AS op2,
               'CAMISETA POLO ' || c.valor || ' ' || t.valor AS nombre,
               CASE t.valor WHEN 'XL' THEN 8.00 ELSE 7.20 END AS costo,
               CASE t.valor WHEN 'XL' THEN 12.00 ELSE 11.00 END AS venta,
               ((hashtext('POLO' || t.valor || c.valor) % 15 + 15) % 15) AS stock,
               ROW_NUMBER() OVER () AS rn
        FROM atributo_opciones t, atributo_opciones c
        WHERE t.atributo_id = v_attr_talla AND t.valor IN ('S','M','L','XL')
          AND c.atributo_id = v_attr_color AND c.valor IN ('NEGRO','BLANCO','GRIS','AZUL')
    ), ins AS (
        INSERT INTO productos (id, negocio_id, producto_template_id, categoria_id, tipo_venta, unidad_medida,
                               codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
        SELECT prod_id, v_negocio_id, v_tmpl, NULL, NULL, NULL,
               '2098' || LPAD((200000 + rn)::TEXT, 9, '0'), nombre, costo, venta, stock, 2, TRUE
        FROM combos RETURNING id
    )
    INSERT INTO producto_atributos (producto_id, atributo_opcion_id)
    SELECT prod_id, op FROM combos CROSS JOIN LATERAL (VALUES (op1), (op2)) v(op);

    -- 7.3 MEDIAS DEPORTIVAS — TALLA(35-38,39-42,43-46) × COLOR(NEGRO,BLANCO,GRIS,AZUL) = 12 SKUs
    v_tmpl := uuid_generate_v4();
    INSERT INTO producto_templates (id, negocio_id, nombre, categoria_id) VALUES (v_tmpl, v_negocio_id, 'MEDIAS DEPORTIVAS', v_cat_ropa);
    v_ta1 := uuid_generate_v4(); v_ta2 := uuid_generate_v4();
    INSERT INTO template_atributos (id, template_id, atributo_id) VALUES (v_ta1, v_tmpl, v_attr_talla), (v_ta2, v_tmpl, v_attr_color);
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta1, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_talla AND o.valor IN ('35-38','39-42','43-46');
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta2, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_color AND o.valor IN ('NEGRO','BLANCO','GRIS','AZUL');

    WITH combos AS (
        SELECT uuid_generate_v4() AS prod_id, t.id AS op1, c.id AS op2,
               'MEDIAS DEPORTIVAS ' || c.valor || ' ' || t.valor AS nombre,
               1.10::NUMERIC AS costo, 1.75::NUMERIC AS venta,
               ((hashtext('MED' || t.valor || c.valor) % 30 + 30) % 30) AS stock,
               ROW_NUMBER() OVER () AS rn
        FROM atributo_opciones t, atributo_opciones c
        WHERE t.atributo_id = v_attr_talla AND t.valor IN ('35-38','39-42','43-46')
          AND c.atributo_id = v_attr_color AND c.valor IN ('NEGRO','BLANCO','GRIS','AZUL')
    ), ins AS (
        INSERT INTO productos (id, negocio_id, producto_template_id, categoria_id, tipo_venta, unidad_medida,
                               codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
        SELECT prod_id, v_negocio_id, v_tmpl, NULL, NULL, NULL,
               '2098' || LPAD((300000 + rn)::TEXT, 9, '0'), nombre, costo, venta, stock, 5, TRUE
        FROM combos RETURNING id
    )
    INSERT INTO producto_atributos (producto_id, atributo_opcion_id)
    SELECT prod_id, op FROM combos CROSS JOIN LATERAL (VALUES (op1), (op2)) v(op);

    -- 7.4 BUZO CAPUCHA — TALLA(4) × COLOR(NEGRO,GRIS,AZUL) = 12 SKUs
    v_tmpl := uuid_generate_v4();
    INSERT INTO producto_templates (id, negocio_id, nombre, categoria_id) VALUES (v_tmpl, v_negocio_id, 'BUZO CAPUCHA', v_cat_ropa);
    v_ta1 := uuid_generate_v4(); v_ta2 := uuid_generate_v4();
    INSERT INTO template_atributos (id, template_id, atributo_id) VALUES (v_ta1, v_tmpl, v_attr_talla), (v_ta2, v_tmpl, v_attr_color);
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta1, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_talla AND o.valor IN ('S','M','L','XL');
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta2, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_color AND o.valor IN ('NEGRO','GRIS','AZUL');

    WITH combos AS (
        SELECT uuid_generate_v4() AS prod_id, t.id AS op1, c.id AS op2,
               'BUZO CAPUCHA ' || c.valor || ' ' || t.valor AS nombre,
               CASE t.valor WHEN 'XL' THEN 13.00 ELSE 12.00 END AS costo,
               CASE t.valor WHEN 'XL' THEN 19.50 ELSE 18.00 END AS venta,
               ((hashtext('BUZO' || t.valor || c.valor) % 8 + 8) % 8) AS stock,
               ROW_NUMBER() OVER () AS rn
        FROM atributo_opciones t, atributo_opciones c
        WHERE t.atributo_id = v_attr_talla AND t.valor IN ('S','M','L','XL')
          AND c.atributo_id = v_attr_color AND c.valor IN ('NEGRO','GRIS','AZUL')
    ), ins AS (
        INSERT INTO productos (id, negocio_id, producto_template_id, categoria_id, tipo_venta, unidad_medida,
                               codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
        SELECT prod_id, v_negocio_id, v_tmpl, NULL, NULL, NULL,
               '2098' || LPAD((400000 + rn)::TEXT, 9, '0'), nombre, costo, venta, stock, 2, TRUE
        FROM combos RETURNING id
    )
    INSERT INTO producto_atributos (producto_id, atributo_opcion_id)
    SELECT prod_id, op FROM combos CROSS JOIN LATERAL (VALUES (op1), (op2)) v(op);

    -- 7.5 GORRA — COLOR(NEGRO,BLANCO,ROJO,AZUL,VERDE) = 5 SKUs
    v_tmpl := uuid_generate_v4();
    INSERT INTO producto_templates (id, negocio_id, nombre, categoria_id) VALUES (v_tmpl, v_negocio_id, 'GORRA DEPORTIVA', v_cat_ropa);
    v_ta1 := uuid_generate_v4();
    INSERT INTO template_atributos (id, template_id, atributo_id) VALUES (v_ta1, v_tmpl, v_attr_color);
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta1, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_color AND o.valor IN ('NEGRO','BLANCO','ROJO','AZUL','VERDE');

    WITH combos AS (
        SELECT uuid_generate_v4() AS prod_id, c.id AS op1,
               'GORRA DEPORTIVA ' || c.valor AS nombre,
               3.50::NUMERIC AS costo, 5.50::NUMERIC AS venta,
               ((hashtext('GORRA' || c.valor) % 12 + 12) % 12) AS stock,
               ROW_NUMBER() OVER () AS rn
        FROM atributo_opciones c
        WHERE c.atributo_id = v_attr_color AND c.valor IN ('NEGRO','BLANCO','ROJO','AZUL','VERDE')
    ), ins AS (
        INSERT INTO productos (id, negocio_id, producto_template_id, categoria_id, tipo_venta, unidad_medida,
                               codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
        SELECT prod_id, v_negocio_id, v_tmpl, NULL, NULL, NULL,
               '2098' || LPAD((500000 + rn)::TEXT, 9, '0'), nombre, costo, venta, stock, 2, TRUE
        FROM combos RETURNING id
    )
    INSERT INTO producto_atributos (producto_id, atributo_opcion_id)
    SELECT prod_id, op1 FROM combos;

    -- 7.6 BATIDO DE FRUTA — SABOR(FRESA,MORA,MANGO,GUANÁBANA) × TAMAÑO(2) = 8 SKUs
    v_tmpl := uuid_generate_v4();
    INSERT INTO producto_templates (id, negocio_id, nombre, categoria_id) VALUES (v_tmpl, v_negocio_id, 'BATIDO DE FRUTA', v_cat_bebidas);
    v_ta1 := uuid_generate_v4(); v_ta2 := uuid_generate_v4();
    INSERT INTO template_atributos (id, template_id, atributo_id) VALUES (v_ta1, v_tmpl, v_attr_sabor), (v_ta2, v_tmpl, v_attr_tamano);
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta1, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_sabor AND o.valor IN ('FRESA','MORA','MANGO','GUANÁBANA');
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta2, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_tamano AND o.valor IN ('PEQUEÑO','GRANDE');

    WITH combos AS (
        SELECT uuid_generate_v4() AS prod_id, s.id AS op1, z.id AS op2,
               'BATIDO DE FRUTA ' || s.valor || ' ' || z.valor AS nombre,
               CASE z.valor WHEN 'GRANDE' THEN 0.80 ELSE 0.55 END AS costo,
               CASE z.valor WHEN 'GRANDE' THEN 1.50 ELSE 1.00 END AS venta,
               ((hashtext('BAT' || s.valor || z.valor) % 25 + 25) % 25) AS stock,
               ROW_NUMBER() OVER () AS rn
        FROM atributo_opciones s, atributo_opciones z
        WHERE s.atributo_id = v_attr_sabor AND s.valor IN ('FRESA','MORA','MANGO','GUANÁBANA')
          AND z.atributo_id = v_attr_tamano AND z.valor IN ('PEQUEÑO','GRANDE')
    ), ins AS (
        INSERT INTO productos (id, negocio_id, producto_template_id, categoria_id, tipo_venta, unidad_medida,
                               codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
        SELECT prod_id, v_negocio_id, v_tmpl, NULL, NULL, NULL,
               '2098' || LPAD((600000 + rn)::TEXT, 9, '0'), nombre, costo, venta, stock, 5, TRUE
        FROM combos RETURNING id
    )
    INSERT INTO producto_atributos (producto_id, atributo_opcion_id)
    SELECT prod_id, op FROM combos CROSS JOIN LATERAL (VALUES (op1), (op2)) v(op);

    -- 7.7 JUGO NATURAL — SABOR(5) × TAMAÑO(2) = 10 SKUs
    v_tmpl := uuid_generate_v4();
    INSERT INTO producto_templates (id, negocio_id, nombre, categoria_id) VALUES (v_tmpl, v_negocio_id, 'JUGO NATURAL', v_cat_bebidas);
    v_ta1 := uuid_generate_v4(); v_ta2 := uuid_generate_v4();
    INSERT INTO template_atributos (id, template_id, atributo_id) VALUES (v_ta1, v_tmpl, v_attr_sabor), (v_ta2, v_tmpl, v_attr_tamano);
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta1, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_sabor AND o.valor IN ('FRESA','MORA','MANGO','MARACUYÁ','COCO');
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta2, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_tamano AND o.valor IN ('PEQUEÑO','GRANDE');

    WITH combos AS (
        SELECT uuid_generate_v4() AS prod_id, s.id AS op1, z.id AS op2,
               'JUGO NATURAL ' || s.valor || ' ' || z.valor AS nombre,
               CASE z.valor WHEN 'GRANDE' THEN 0.70 ELSE 0.45 END AS costo,
               CASE z.valor WHEN 'GRANDE' THEN 1.25 ELSE 0.80 END AS venta,
               ((hashtext('JUGO' || s.valor || z.valor) % 20 + 20) % 20) AS stock,
               ROW_NUMBER() OVER () AS rn
        FROM atributo_opciones s, atributo_opciones z
        WHERE s.atributo_id = v_attr_sabor AND s.valor IN ('FRESA','MORA','MANGO','MARACUYÁ','COCO')
          AND z.atributo_id = v_attr_tamano AND z.valor IN ('PEQUEÑO','GRANDE')
    ), ins AS (
        INSERT INTO productos (id, negocio_id, producto_template_id, categoria_id, tipo_venta, unidad_medida,
                               codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
        SELECT prod_id, v_negocio_id, v_tmpl, NULL, NULL, NULL,
               '2098' || LPAD((700000 + rn)::TEXT, 9, '0'), nombre, costo, venta, stock, 4, TRUE
        FROM combos RETURNING id
    )
    INSERT INTO producto_atributos (producto_id, atributo_opcion_id)
    SELECT prod_id, op FROM combos CROSS JOIN LATERAL (VALUES (op1), (op2)) v(op);

    -- 7.8 TAPIOCA — SABOR(5) × TAMAÑO(2) = 10 SKUs
    v_tmpl := uuid_generate_v4();
    INSERT INTO producto_templates (id, negocio_id, nombre, categoria_id) VALUES (v_tmpl, v_negocio_id, 'TAPIOCA', v_cat_bebidas);
    v_ta1 := uuid_generate_v4(); v_ta2 := uuid_generate_v4();
    INSERT INTO template_atributos (id, template_id, atributo_id) VALUES (v_ta1, v_tmpl, v_attr_sabor), (v_ta2, v_tmpl, v_attr_tamano);
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta1, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_sabor AND o.valor IN ('FRESA','CHOCOLATE','VAINILLA','MANGO','COCO');
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta2, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_tamano AND o.valor IN ('PEQUEÑO','GRANDE');

    WITH combos AS (
        SELECT uuid_generate_v4() AS prod_id, s.id AS op1, z.id AS op2,
               'TAPIOCA ' || s.valor || ' ' || z.valor AS nombre,
               CASE z.valor WHEN 'GRANDE' THEN 1.10 ELSE 0.80 END AS costo,
               CASE z.valor WHEN 'GRANDE' THEN 2.00 ELSE 1.50 END AS venta,
               ((hashtext('TAP' || s.valor || z.valor) % 18 + 18) % 18) AS stock,
               ROW_NUMBER() OVER () AS rn
        FROM atributo_opciones s, atributo_opciones z
        WHERE s.atributo_id = v_attr_sabor AND s.valor IN ('FRESA','CHOCOLATE','VAINILLA','MANGO','COCO')
          AND z.atributo_id = v_attr_tamano AND z.valor IN ('PEQUEÑO','GRANDE')
    ), ins AS (
        INSERT INTO productos (id, negocio_id, producto_template_id, categoria_id, tipo_venta, unidad_medida,
                               codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
        SELECT prod_id, v_negocio_id, v_tmpl, NULL, NULL, NULL,
               '2098' || LPAD((800000 + rn)::TEXT, 9, '0'), nombre, costo, venta, stock, 4, TRUE
        FROM combos RETURNING id
    )
    INSERT INTO producto_atributos (producto_id, atributo_opcion_id)
    SELECT prod_id, op FROM combos CROSS JOIN LATERAL (VALUES (op1), (op2)) v(op);

    -- 7.9 HELADO DE PAILA — SABOR(6) = 6 SKUs
    v_tmpl := uuid_generate_v4();
    INSERT INTO producto_templates (id, negocio_id, nombre, categoria_id) VALUES (v_tmpl, v_negocio_id, 'HELADO DE PAILA', v_cat_snacks);
    v_ta1 := uuid_generate_v4();
    INSERT INTO template_atributos (id, template_id, atributo_id) VALUES (v_ta1, v_tmpl, v_attr_sabor);
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta1, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_sabor AND o.valor IN ('FRESA','MORA','CHOCOLATE','VAINILLA','COCO','GUANÁBANA');

    WITH combos AS (
        SELECT uuid_generate_v4() AS prod_id, s.id AS op1,
               'HELADO DE PAILA ' || s.valor AS nombre,
               0.55::NUMERIC AS costo, 1.00::NUMERIC AS venta,
               ((hashtext('HEL' || s.valor) % 30 + 30) % 30) AS stock,
               ROW_NUMBER() OVER () AS rn
        FROM atributo_opciones s
        WHERE s.atributo_id = v_attr_sabor AND s.valor IN ('FRESA','MORA','CHOCOLATE','VAINILLA','COCO','GUANÁBANA')
    ), ins AS (
        INSERT INTO productos (id, negocio_id, producto_template_id, categoria_id, tipo_venta, unidad_medida,
                               codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
        SELECT prod_id, v_negocio_id, v_tmpl, NULL, NULL, NULL,
               '2098' || LPAD((900000 + rn)::TEXT, 9, '0'), nombre, costo, venta, stock, 6, TRUE
        FROM combos RETURNING id
    )
    INSERT INTO producto_atributos (producto_id, atributo_opcion_id)
    SELECT prod_id, op1 FROM combos;

    -- 7.10 ESMALTE DE UÑAS — COLOR(8) = 8 SKUs
    v_tmpl := uuid_generate_v4();
    INSERT INTO producto_templates (id, negocio_id, nombre, categoria_id) VALUES (v_tmpl, v_negocio_id, 'ESMALTE DE UÑAS', v_cat_aseo);
    v_ta1 := uuid_generate_v4();
    INSERT INTO template_atributos (id, template_id, atributo_id) VALUES (v_ta1, v_tmpl, v_attr_color);
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta1, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_color AND o.valor IN ('ROJO','ROSADO','MORADO','NEGRO','BLANCO','CELESTE','VERDE','AMARILLO');

    WITH combos AS (
        SELECT uuid_generate_v4() AS prod_id, c.id AS op1,
               'ESMALTE DE UÑAS ' || c.valor AS nombre,
               0.90::NUMERIC AS costo, 1.50::NUMERIC AS venta,
               ((hashtext('ESM' || c.valor) % 15 + 15) % 15) AS stock,
               ROW_NUMBER() OVER () AS rn
        FROM atributo_opciones c
        WHERE c.atributo_id = v_attr_color AND c.valor IN ('ROJO','ROSADO','MORADO','NEGRO','BLANCO','CELESTE','VERDE','AMARILLO')
    ), ins AS (
        INSERT INTO productos (id, negocio_id, producto_template_id, categoria_id, tipo_venta, unidad_medida,
                               codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
        SELECT prod_id, v_negocio_id, v_tmpl, NULL, NULL, NULL,
               '2098' || LPAD((1000000 + rn)::TEXT, 9, '0'), nombre, costo, venta, stock, 3, TRUE
        FROM combos RETURNING id
    )
    INSERT INTO producto_atributos (producto_id, atributo_opcion_id)
    SELECT prod_id, op1 FROM combos;

    -- 7.11 VELA AROMÁTICA — AROMA(6) = 6 SKUs
    v_tmpl := uuid_generate_v4();
    INSERT INTO producto_templates (id, negocio_id, nombre, categoria_id) VALUES (v_tmpl, v_negocio_id, 'VELA AROMÁTICA', v_cat_bazar);
    v_ta1 := uuid_generate_v4();
    INSERT INTO template_atributos (id, template_id, atributo_id) VALUES (v_ta1, v_tmpl, v_attr_aroma);
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta1, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_aroma;

    WITH combos AS (
        SELECT uuid_generate_v4() AS prod_id, a.id AS op1,
               'VELA AROMÁTICA ' || a.valor AS nombre,
               1.40::NUMERIC AS costo, 2.25::NUMERIC AS venta,
               ((hashtext('VELA' || a.valor) % 10 + 10) % 10) AS stock,
               ROW_NUMBER() OVER () AS rn
        FROM atributo_opciones a
        WHERE a.atributo_id = v_attr_aroma
    ), ins AS (
        INSERT INTO productos (id, negocio_id, producto_template_id, categoria_id, tipo_venta, unidad_medida,
                               codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
        SELECT prod_id, v_negocio_id, v_tmpl, NULL, NULL, NULL,
               '2098' || LPAD((1100000 + rn)::TEXT, 9, '0'), nombre, costo, venta, stock, 2, TRUE
        FROM combos RETURNING id
    )
    INSERT INTO producto_atributos (producto_id, atributo_opcion_id)
    SELECT prod_id, op1 FROM combos;

    -- 7.12 PULSERA TEJIDA — COLOR(6) = 6 SKUs
    v_tmpl := uuid_generate_v4();
    INSERT INTO producto_templates (id, negocio_id, nombre, categoria_id) VALUES (v_tmpl, v_negocio_id, 'PULSERA TEJIDA', v_cat_bazar);
    v_ta1 := uuid_generate_v4();
    INSERT INTO template_atributos (id, template_id, atributo_id) VALUES (v_ta1, v_tmpl, v_attr_color);
    INSERT INTO template_atributo_opciones (template_atributo_id, atributo_opcion_id)
        SELECT v_ta1, o.id FROM atributo_opciones o WHERE o.atributo_id = v_attr_color AND o.valor IN ('ROJO','AZUL','VERDE','MORADO','ROSADO','AMARILLO');

    WITH combos AS (
        SELECT uuid_generate_v4() AS prod_id, c.id AS op1,
               'PULSERA TEJIDA ' || c.valor AS nombre,
               0.40::NUMERIC AS costo, 0.75::NUMERIC AS venta,
               ((hashtext('PUL' || c.valor) % 20 + 20) % 20) AS stock,
               ROW_NUMBER() OVER () AS rn
        FROM atributo_opciones c
        WHERE c.atributo_id = v_attr_color AND c.valor IN ('ROJO','AZUL','VERDE','MORADO','ROSADO','AMARILLO')
    ), ins AS (
        INSERT INTO productos (id, negocio_id, producto_template_id, categoria_id, tipo_venta, unidad_medida,
                               codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva)
        SELECT prod_id, v_negocio_id, v_tmpl, NULL, NULL, NULL,
               '2098' || LPAD((1200000 + rn)::TEXT, 9, '0'), nombre, costo, venta, stock, 4, TRUE
        FROM combos RETURNING id
    )
    INSERT INTO producto_atributos (producto_id, atributo_opcion_id)
    SELECT prod_id, op1 FROM combos;

    -- ────────────────────────────────────────────────────────────────────
    -- 8. KARDEX INICIAL — una COMPRA "Stock inicial" por producto con stock > 0
    --    (así la página de kárdex tiene historial desde el día uno)
    -- ────────────────────────────────────────────────────────────────────
    INSERT INTO kardex_inventario (negocio_id, producto_id, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, observaciones)
    SELECT p.negocio_id, p.id, 'COMPRA', p.stock_actual, 0, p.stock_actual,
           'Stock inicial — seed de prueba'
    FROM productos p
    WHERE p.negocio_id = v_negocio_id
      AND p.stock_actual > 0
      AND (p.codigo_barras LIKE '7861234%' OR p.codigo_barras LIKE '2098%');

    -- ────────────────────────────────────────────────────────────────────
    -- 9. RESUMEN
    -- ────────────────────────────────────────────────────────────────────
    RAISE NOTICE '════════════ SEED COMPLETADO ════════════';
    RAISE NOTICE 'Productos totales:       %', (SELECT COUNT(*) FROM productos WHERE negocio_id = v_negocio_id AND (codigo_barras LIKE '7861234%' OR codigo_barras LIKE '2098%'));
    RAISE NOTICE '  · simples activos:     %', (SELECT COUNT(*) FROM productos WHERE negocio_id = v_negocio_id AND codigo_barras LIKE '7861234%' AND producto_template_id IS NULL AND activo);
    RAISE NOTICE '  · SKUs de variantes:   %', (SELECT COUNT(*) FROM productos WHERE negocio_id = v_negocio_id AND codigo_barras LIKE '2098%');
    RAISE NOTICE '  · desactivados:        %', (SELECT COUNT(*) FROM productos WHERE negocio_id = v_negocio_id AND codigo_barras LIKE '7861234%' AND NOT activo);
    RAISE NOTICE '  · agotados (stock 0):  %', (SELECT COUNT(*) FROM productos WHERE negocio_id = v_negocio_id AND (codigo_barras LIKE '7861234%' OR codigo_barras LIKE '2098%') AND activo AND stock_actual = 0);
    RAISE NOTICE '  · en "Reponer":        %', (SELECT COUNT(*) FROM productos WHERE negocio_id = v_negocio_id AND (codigo_barras LIKE '7861234%' OR codigo_barras LIKE '2098%') AND activo AND stock_actual <= stock_minimo);
    RAISE NOTICE 'Presentaciones:          %', (SELECT COUNT(*) FROM producto_presentaciones WHERE negocio_id = v_negocio_id AND codigo_barras LIKE '7864321%');
    RAISE NOTICE 'Templates de variantes:  %', (SELECT COUNT(*) FROM producto_templates WHERE negocio_id = v_negocio_id);
    RAISE NOTICE 'Registros de kardex:     %', (SELECT COUNT(*) FROM kardex_inventario WHERE negocio_id = v_negocio_id AND observaciones = 'Stock inicial — seed de prueba');
END $$;


-- ============================================================================
-- LIMPIEZA (ejecutar SOLO si quieres eliminar todo el seed)
-- Orden importante: kardex primero (FK a productos SIN cascade), luego
-- productos (cascadea presentaciones, producto_atributos y codigos_barras),
-- luego templates huérfanos. Categorías y atributos se dejan (reusables) —
-- descomenta las últimas líneas solo si también quieres borrarlos.
-- ============================================================================
-- DO $$
-- DECLARE
--     v_negocio_id UUID;
-- BEGIN
--     v_negocio_id := (SELECT id FROM negocios WHERE slug = 'tienda-prueba');
--
--     DELETE FROM kardex_inventario
--     WHERE negocio_id = v_negocio_id
--       AND observaciones = 'Stock inicial — seed de prueba';
--
--     DELETE FROM productos
--     WHERE negocio_id = v_negocio_id
--       AND (codigo_barras LIKE '7861234%' OR codigo_barras LIKE '2098%');
--
--     DELETE FROM producto_templates t
--     WHERE t.negocio_id = v_negocio_id
--       AND NOT EXISTS (SELECT 1 FROM productos p WHERE p.producto_template_id = t.id);
--
--     -- Opcional: atributos/opciones del seed (solo si ningún otro producto los usa)
--     -- DELETE FROM atributo_opciones o WHERE o.negocio_id = v_negocio_id
--     --   AND NOT EXISTS (SELECT 1 FROM producto_atributos pa WHERE pa.atributo_opcion_id = o.id);
--     -- DELETE FROM atributos a WHERE a.negocio_id = v_negocio_id
--     --   AND NOT EXISTS (SELECT 1 FROM atributo_opciones o WHERE o.atributo_id = a.id);
--
--     RAISE NOTICE 'Seed eliminado.';
-- END $$;
