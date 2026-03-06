-- ==========================================
-- TRIGGER FUNCTION: fn_actualizar_saldo_caja_venta
-- ==========================================
-- Se dispara automáticamente AFTER INSERT en ventas.
-- Solo actúa si metodo_pago = 'EFECTIVO' y estado = 'COMPLETADA'.
--
-- Flujo:
--   1. Busca la caja principal (codigo = 'CAJA').
--   2. Busca la categoría contable INGRESO cuyo nombre contenga 'Ventas'.
--   3. Busca el tipo_referencia de la tabla 'ventas'.
--   4. Inserta un registro en operaciones_cajas (trazabilidad contable).
--   5. Actualiza saldo_actual de la caja.
--
-- Métodos de pago alternativos (DEUNA, TRANSFERENCIA, FIADO):
--   No disparan esta función — se concilian fuera del sistema o de forma manual.
--
-- ⚠️  NO ejecutar manualmente. El trigger lo invoca el motor de PostgreSQL.
-- ⚠️  No borrar sin borrar también el trigger trg_actualizar_caja_por_venta.
-- ==========================================
-- Usado por: trg_actualizar_caja_por_venta (ON ventas AFTER INSERT)
-- ==========================================

CREATE OR REPLACE FUNCTION fn_actualizar_saldo_caja_venta()
RETURNS TRIGGER AS $$
DECLARE
    v_caja_id            INTEGER;
    v_categoria_id       INTEGER;
    v_tipo_referencia_id INTEGER;
    v_saldo_actual_caja  DECIMAL(12,2);
BEGIN
    IF NEW.metodo_pago = 'EFECTIVO' AND NEW.estado = 'COMPLETADA' THEN

        SELECT id INTO v_caja_id
        FROM cajas WHERE codigo = 'CAJA';

        SELECT id INTO v_categoria_id
        FROM categorias_operaciones
        WHERE tipo = 'INGRESO' AND nombre ILIKE '%Ventas%'
        LIMIT 1;

        SELECT id INTO v_tipo_referencia_id
        FROM tipos_referencia WHERE tabla = 'ventas'
        LIMIT 1;

        IF v_caja_id IS NOT NULL AND v_categoria_id IS NOT NULL THEN
            SELECT saldo_actual INTO v_saldo_actual_caja
            FROM cajas WHERE id = v_caja_id;

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

CREATE TRIGGER trg_actualizar_caja_por_venta
    AFTER INSERT ON ventas
    FOR EACH ROW
    EXECUTE FUNCTION fn_actualizar_saldo_caja_venta();
