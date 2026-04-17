-- ============================================================
-- Constraints e índices para producto_presentaciones (v8.1)
-- Ejecutar UNA SOLA VEZ sobre la BD existente.
-- Ya incluido en docs/schema.sql para instalaciones nuevas.
-- ============================================================

-- 1. Solo 1 presentacion principal por producto
--    Si ya existe un duplicado, resolver manualmente antes de ejecutar.
CREATE UNIQUE INDEX IF NOT EXISTS uq_presentaciones_principal
    ON producto_presentaciones(producto_id) WHERE es_principal = TRUE;

-- 2. Nombres únicos por producto (case-insensitive + trim)
--    Previene "Cajetilla x10" y "cajetilla x10" en el mismo producto.
CREATE UNIQUE INDEX IF NOT EXISTS uq_presentaciones_nombre
    ON producto_presentaciones(producto_id, LOWER(TRIM(nombre)));

-- 3. Índice compuesto para búsquedas POS (producto_id + activo)
--    Acelera: SELECT ... WHERE producto_id = $1 AND activo = TRUE
CREATE INDEX IF NOT EXISTS idx_presentaciones_producto_activo
    ON producto_presentaciones(producto_id, activo);
