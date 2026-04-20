-- ==========================================
-- MIGRACIÓN v9 — Grupos de Variantes
-- ==========================================
-- Ejecutar UNA SOLA VEZ en Supabase SQL Editor sobre una BD existente en v8.
-- No borra datos. Solo agrega tabla y columna nueva.
--
-- Qué hace:
--   1. Crea tabla grupos_variantes
--   2. Agrega columna grupo_variante_id en productos (FK, nullable)
--   3. Crea índice parcial
--   4. Refresca schema de PostgREST
-- ==========================================

-- 1. Nueva tabla grupos_variantes
CREATE TABLE IF NOT EXISTS grupos_variantes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT grupos_variantes_nombre_normalizado CHECK (nombre = UPPER(TRIM(nombre)))
);

-- 2. Nueva columna en productos
ALTER TABLE productos
    ADD COLUMN IF NOT EXISTS grupo_variante_id UUID REFERENCES grupos_variantes(id) ON DELETE SET NULL;

-- 3. Índice parcial (solo filas con grupo asignado)
CREATE INDEX IF NOT EXISTS idx_productos_grupo_variante
    ON productos(grupo_variante_id) WHERE grupo_variante_id IS NOT NULL;

-- 4. Refrescar schema de PostgREST
NOTIFY pgrst, 'reload schema';
