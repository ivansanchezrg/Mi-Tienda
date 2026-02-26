-- ==========================================
-- MIGRACIÓN: Agregar categorías para ajuste de déficit turno anterior
-- Ejecutar en Supabase SQL Editor (producción)
-- Fecha: 2026-02-20
-- ==========================================

-- Agregar categoría de EGRESO para retirar de Tienda
INSERT INTO categorias_operaciones (tipo, nombre, codigo, descripcion)
VALUES (
  'EGRESO',
  'Ajuste Déficit Turno Anterior',
  'EG-012',
  'Retiro de Tienda para reponer déficit del turno anterior (fondo faltante + Caja Chica pendiente)'
)
ON CONFLICT (codigo) DO NOTHING;

-- Agregar categoría de INGRESO para reponer a Varios
INSERT INTO categorias_operaciones (tipo, nombre, codigo, descripcion)
VALUES (
  'INGRESO',
  'Reposición Déficit Turno Anterior',
  'IN-004',
  'Ingreso a Varios por reposición del déficit pendiente del turno anterior'
)
ON CONFLICT (codigo) DO NOTHING;

-- Verificar que quedaron insertadas
SELECT id, tipo, nombre, codigo FROM categorias_operaciones
WHERE codigo IN ('EG-012', 'IN-004')
ORDER BY codigo;
