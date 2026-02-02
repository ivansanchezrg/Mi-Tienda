-- ==========================================
-- LIMPIEZA TOTAL - Eliminar schema anterior
-- Ejecutar en Supabase antes de crear nuevo schema
-- ==========================================

-- Eliminar tablas (orden por dependencias)
DROP TABLE IF EXISTS operaciones_cajas CASCADE;
DROP TABLE IF EXISTS gastos CASCADE;
DROP TABLE IF EXISTS movimientos CASCADE;
DROP TABLE IF EXISTS ventas_diarias CASCADE;
DROP TABLE IF EXISTS recargas CASCADE;
DROP TABLE IF EXISTS configuraciones CASCADE;
DROP TABLE IF EXISTS cajas CASCADE;
DROP TABLE IF EXISTS tipos_servicio CASCADE;
DROP TABLE IF EXISTS empleados CASCADE;

-- Eliminar ENUMs
DROP TYPE IF EXISTS tipo_recarga_enum CASCADE;
DROP TYPE IF EXISTS tipo_movimiento_enum CASCADE;
DROP TYPE IF EXISTS concepto_movimiento_enum CASCADE;
DROP TYPE IF EXISTS categoria_gasto_enum CASCADE;
DROP TYPE IF EXISTS tipo_operacion_caja_enum CASCADE;

-- Verificar que todo fue eliminado
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE';
