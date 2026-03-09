-- ==========================================
-- MIGRACIÓN v5 — Nueva Arquitectura de Caja Chica Diaria
-- ==========================================
-- ⚠️  Ejecutar en Supabase SQL Editor UNA SOLA VEZ.
-- ⚠️  Respaldar datos de gastos_diarios y caja_fisica_diaria antes de ejecutar.
-- ⚠️  Ejecutar ANTES de desplegar el código Angular v5.
--
-- Pasos incluidos:
--   1a. Renombrar CAJA_CHICA → VARIOS
--   1b. Crear nueva CAJA_CHICA (cajón físico diario)
--   1c. Eliminar tablas obsoletas
--   1d. Limpiar tipos_referencia
--   1e. Agregar categorías de ajuste por conteo físico
--   2.  Actualizar trigger de ventas POS (CAJA → CAJA_CHICA)
-- ==========================================



-- ==========================================
-- PASO 1a. Renombrar CAJA_CHICA → VARIOS
-- ==========================================
UPDATE cajas
SET
  codigo      = 'VARIOS',
  nombre      = 'Varios',
  descripcion = 'Fondo de emergencia — recibe transferencia diaria en cada cierre'
WHERE codigo = 'CAJA_CHICA';



-- ==========================================
-- PASO 1b. Crear nueva CAJA_CHICA (cajón físico diario)
-- ==========================================
INSERT INTO cajas (codigo, nombre, descripcion, saldo_actual)
VALUES (
  'CAJA_CHICA',
  'Caja Chica',
  'Cajón físico diario — ventas efectivo y egresos del día. Se resetea a $0 en cada cierre.',
  0.00
);



-- ==========================================
-- PASO 1c. Eliminar tablas obsoletas
-- (Los gastos se registran ahora como EGRESOS en CAJA_CHICA via operaciones_cajas)
-- ==========================================
DROP TABLE IF EXISTS gastos_diarios    CASCADE;
DROP TABLE IF EXISTS categorias_gastos CASCADE;
DROP TABLE IF EXISTS caja_fisica_diaria CASCADE;



-- ==========================================
-- PASO 1d. Limpiar tipos_referencia obsoletos
-- ==========================================
DELETE FROM tipos_referencia WHERE tabla = 'caja_fisica_diaria';



-- ==========================================
-- PASO 1e. Agregar categorías de ajuste por conteo físico
-- Códigos se auto-generan por trigger:
--   EG-013: Ajuste Diferencia Conteo (EGRESO)
--   IN-005: Ajuste Diferencia Conteo (INGRESO)
-- ==========================================
INSERT INTO categorias_operaciones (tipo, nombre, descripcion, seleccionable) VALUES
(
  'INGRESO',
  'Ajuste Diferencia Conteo',
  'Ajuste automático al cierre cuando el conteo físico supera al saldo digital del cajón',
  FALSE
),
(
  'EGRESO',
  'Ajuste Diferencia Conteo',
  'Ajuste automático al cierre cuando el conteo físico es menor al saldo digital del cajón',
  FALSE
);



-- ==========================================
-- PASO 2. Actualizar trigger de ventas POS
-- Redirigir EFECTIVO de CAJA (bóveda) → CAJA_CHICA (cajón diario)
-- ==========================================
CREATE OR REPLACE FUNCTION fn_actualizar_saldo_caja_venta()
RETURNS TRIGGER AS $$
DECLARE
    v_caja_id            INTEGER;
    v_categoria_id       INTEGER;
    v_tipo_referencia_id INTEGER;
    v_saldo_actual_caja  DECIMAL(12,2);
BEGIN
    -- Solo procesar ventas EFECTIVO completadas
    IF NEW.metodo_pago = 'EFECTIVO' AND NEW.estado = 'COMPLETADA' THEN

        -- v5: Ingreso va al cajón diario (CAJA_CHICA), no a la bóveda (CAJA)
        SELECT id INTO v_caja_id FROM cajas WHERE codigo = 'CAJA_CHICA';
        SELECT id INTO v_categoria_id
          FROM categorias_operaciones
         WHERE tipo = 'INGRESO' AND nombre ILIKE '%Ventas%'
         LIMIT 1;
        SELECT id INTO v_tipo_referencia_id
          FROM tipos_referencia
         WHERE tabla = 'ventas'
         LIMIT 1;

        IF v_caja_id IS NOT NULL AND v_categoria_id IS NOT NULL THEN
            SELECT saldo_actual INTO v_saldo_actual_caja FROM cajas WHERE id = v_caja_id;

            INSERT INTO operaciones_cajas (
                caja_id, empleado_id, tipo_operacion, monto,
                saldo_anterior, saldo_actual,
                categoria_id, tipo_referencia_id, referencia_id, descripcion
            ) VALUES (
                v_caja_id,
                NEW.empleado_id,
                'INGRESO',
                NEW.total,
                v_saldo_actual_caja,
                v_saldo_actual_caja + NEW.total,
                v_categoria_id,
                v_tipo_referencia_id,
                NEW.id,
                'Venta POS Efectivo'
            );

            UPDATE cajas
               SET saldo_actual = saldo_actual + NEW.total
             WHERE id = v_caja_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Refrescar caché de PostgREST
NOTIFY pgrst, 'reload schema';



-- ==========================================
-- VERIFICACIÓN FINAL
-- ==========================================
-- Ejecutar estas queries para confirmar que todo quedó correcto:

-- 1. Confirmar 5 cajas activas:
-- SELECT codigo, nombre, saldo_actual FROM cajas ORDER BY id;
-- Esperado: CAJA, CAJA_CHICA (nueva), VARIOS (renombrada), CAJA_CELULAR, CAJA_BUS

-- 2. Confirmar que las tablas ya no existen:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_name IN ('caja_fisica_diaria', 'gastos_diarios', 'categorias_gastos');
-- Esperado: 0 filas

-- 3. Confirmar nuevas categorías de ajuste:
-- SELECT codigo, tipo, nombre FROM categorias_operaciones
-- WHERE nombre = 'Ajuste Diferencia Conteo';
-- Esperado: EG-013 y IN-005

-- 4. Confirmar tipo_referencia limpio:
-- SELECT * FROM tipos_referencia WHERE tabla = 'caja_fisica_diaria';
-- Esperado: 0 filas
