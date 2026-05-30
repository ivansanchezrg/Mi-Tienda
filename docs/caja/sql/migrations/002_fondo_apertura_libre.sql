-- ============================================================
-- Migración: fondo_apertura libre en turnos_caja
-- Fecha: 2026-05-29
-- ============================================================
-- Qué cambia:
--   1. turnos_caja: agrega fondo_apertura (monto libre que el empleado
--      declara al abrir), elimina fondo_cubierto (ya no aplica sin fondo fijo).
--   2. configuraciones: elimina la clave caja_fondo_fijo_diario (ya no existe
--      fondo predeterminado — el empleado ingresa el monto al abrir).
-- ============================================================

-- 1. Agregar columna fondo_apertura
ALTER TABLE turnos_caja
  ADD COLUMN IF NOT EXISTS fondo_apertura DECIMAL(12,2) NOT NULL DEFAULT 0;

-- 2. Eliminar columna fondo_cubierto
ALTER TABLE turnos_caja
  DROP COLUMN IF EXISTS fondo_cubierto;

-- 3. Eliminar clave de configuración global de fondo fijo
DELETE FROM configuraciones WHERE clave = 'caja_fondo_fijo_diario';
