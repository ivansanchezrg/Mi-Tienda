-- ==========================================
-- MIGRACIÓN: Índices para deudas_empleados
-- Fecha: 2026-03-10
-- ==========================================
-- Agregar índices faltantes en la tabla deudas_empleados.
-- Ejecutar UNA sola vez en Supabase SQL Editor.
-- IF NOT EXISTS lo hace seguro para re-ejecuciones accidentales.
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_deudas_empleado ON deudas_empleados(empleado_id);  -- listado/suma por empleado
CREATE INDEX IF NOT EXISTS idx_deudas_estado   ON deudas_empleados(estado);       -- filtro PENDIENTE / SALDADA
CREATE INDEX IF NOT EXISTS idx_deudas_turno    ON deudas_empleados(turno_id);     -- lookup por turno
