-- ==========================================
-- SEED: Productos de prueba — Inventario (v8 - Presentaciones)
-- ==========================================
-- Cubre todos los flujos del modulo de inventario:
--   1. Productos UNIDAD normales (varios estados de stock)
--   2. Producto PESO (granel en libras)
--   3. Producto con presentaciones: Cigarro suelto + Cajetilla x10 + Cajetilla x20
--   4. Producto con presentaciones: Huevo suelto + Cubeta x30
--   5. Stock bajo y agotado (para probar badges visuales)
--
-- ⚠️  Ejecutar DESPUES del schema.sql y de que existan las categorias.
-- ⚠️  Requiere que las categorias semilla esten creadas (schema.sql las inserta).
--     1=Bebidas | 2=Snacks | 3=Abarrotes | 4=Lacteos | 5=Limpieza | 6=Aseo Personal | 7=Panaderia
--
-- Para limpiar: DELETE FROM productos WHERE codigo_barras LIKE 'TEST-%';
-- ==========================================

-- ==========================================
-- 1. UNIDAD — stock normal
-- ==========================================
INSERT INTO productos (categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva, tipo_venta, unidad_medida) VALUES
(1, 'TEST-001', 'Coca-Cola 600ml',         0.55, 0.75, 48, 10, TRUE,  'UNIDAD', 'und'),
(1, 'TEST-002', 'Agua sin Gas 500ml',      0.20, 0.35, 60, 12, FALSE, 'UNIDAD', 'und'),
(1, 'TEST-003', 'Gatorade Limon 500ml',    0.80, 1.25, 24,  6, TRUE,  'UNIDAD', 'und'),
(2, 'TEST-004', 'Doritos 50g',             0.35, 0.50, 40, 10, TRUE,  'UNIDAD', 'und'),
(2, 'TEST-005', 'Chifles Sal 100g',        0.45, 0.65, 30,  8, TRUE,  'UNIDAD', 'und'),
(3, 'TEST-006', 'Arroz 1kg',               0.85, 1.10, 80, 20, FALSE, 'UNIDAD', 'und'),
(3, 'TEST-007', 'Aceite El Cocinero 1L',   1.80, 2.50, 18,  5, FALSE, 'UNIDAD', 'und'),
(4, 'TEST-008', 'Leche Toni 1L',           0.90, 1.20, 36, 10, FALSE, 'UNIDAD', 'und'),
(5, 'TEST-009', 'Fabuloso 500ml',          1.10, 1.75, 20,  5, TRUE,  'UNIDAD', 'und'),
(6, 'TEST-010', 'Jabon Protex 100g',       0.60, 0.90, 25,  8, TRUE,  'UNIDAD', 'und'),
(7, 'TEST-011', 'Pan de Sal (unidad)',      0.10, 0.15, 50, 20, FALSE, 'UNIDAD', 'und');

-- ==========================================
-- 2. UNIDAD — stock bajo (para badge warning)
-- ==========================================
INSERT INTO productos (categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva, tipo_venta, unidad_medida) VALUES
(1, 'TEST-020', 'Jugo Del Valle 300ml',    0.45, 0.65,  3, 10, TRUE,  'UNIDAD', 'und'),
(2, 'TEST-021', 'Galletas Festival 100g',  0.55, 0.80,  2,  8, TRUE,  'UNIDAD', 'und'),
(3, 'TEST-022', 'Atun Real 170g',          0.90, 1.40,  4,  6, FALSE, 'UNIDAD', 'und');

-- ==========================================
-- 3. UNIDAD — stock agotado (para badge danger)
-- ==========================================
INSERT INTO productos (categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva, tipo_venta, unidad_medida) VALUES
(1, 'TEST-030', 'Red Bull 250ml',          1.20, 1.75,  0,  5, TRUE,  'UNIDAD', 'und'),
(5, 'TEST-031', 'Cloro Olimpia 1L',        0.70, 1.10,  0,  3, TRUE,  'UNIDAD', 'und');

-- ==========================================
-- 4. PESO — granel (para badge y flujo PESO en POS)
-- ==========================================
INSERT INTO productos (categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva, tipo_venta, unidad_medida) VALUES
(3, 'TEST-040', 'Azucar Granel',           0.40, 0.55, 25.00, 5, FALSE, 'PESO', 'lb'),
(3, 'TEST-041', 'Arroz Granel',            0.70, 0.90, 40.00, 8, FALSE, 'PESO', 'lb'),
(3, 'TEST-042', 'Frejol Rojo Granel',      0.85, 1.10, 15.50, 5, FALSE, 'PESO', 'lb');

-- ==========================================
-- 5. PRESENTACIONES — Cigarro con Cajetilla x10 y x20
--    Stock vive en el producto base (cigarro suelto = 200 und)
--    Presentaciones son formas de venta alternativas con factor y precio propio
-- ==========================================
DO $$
DECLARE
    v_cigarro_id UUID;
    v_categoria_snacks INTEGER;
BEGIN
    SELECT id INTO v_categoria_snacks FROM categorias_productos WHERE nombre = 'Snacks' LIMIT 1;

    -- Producto base: cigarro suelto (stock real aqui)
    INSERT INTO productos (
        categoria_id, codigo_barras, nombre,
        precio_costo, precio_venta,
        stock_actual, stock_minimo,
        tiene_iva, tipo_venta, unidad_medida
    ) VALUES (
        v_categoria_snacks, 'TEST-050', 'Cigarro Marlboro',
        0.15, 0.25,
        200, 20,
        TRUE, 'UNIDAD', 'und'
    )
    RETURNING id INTO v_cigarro_id;

    -- Presentacion 1: Cajetilla x10 (principal)
    INSERT INTO producto_presentaciones (
        producto_id, nombre, factor_conversion, precio_venta, codigo_barras, es_principal
    ) VALUES (
        v_cigarro_id, 'Cajetilla x10', 10, 2.30, 'TEST-051', TRUE
    );

    -- Presentacion 2: Cajetilla x20
    INSERT INTO producto_presentaciones (
        producto_id, nombre, factor_conversion, precio_venta, codigo_barras, es_principal
    ) VALUES (
        v_cigarro_id, 'Cajetilla x20', 20, 4.50, 'TEST-052', FALSE
    );
END $$;

-- ==========================================
-- 6. PRESENTACIONES — Huevo con Cubeta x30
-- ==========================================
DO $$
DECLARE
    v_huevo_id UUID;
    v_categoria_lacteos INTEGER;
BEGIN
    SELECT id INTO v_categoria_lacteos FROM categorias_productos WHERE nombre = 'Lácteos' LIMIT 1;

    -- Producto base: huevo suelto
    INSERT INTO productos (
        categoria_id, codigo_barras, nombre,
        precio_costo, precio_venta,
        stock_actual, stock_minimo,
        tiene_iva, tipo_venta, unidad_medida
    ) VALUES (
        v_categoria_lacteos, 'TEST-060', 'Huevo',
        0.12, 0.18,
        360, 30,
        FALSE, 'UNIDAD', 'und'
    )
    RETURNING id INTO v_huevo_id;

    -- Presentacion: Cubeta x30
    INSERT INTO producto_presentaciones (
        producto_id, nombre, factor_conversion, precio_venta, codigo_barras, es_principal
    ) VALUES (
        v_huevo_id, 'Cubeta x30', 30, 5.00, 'TEST-061', TRUE
    );
END $$;
