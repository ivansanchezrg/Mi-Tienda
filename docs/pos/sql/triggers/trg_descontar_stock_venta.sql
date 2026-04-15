-- ==========================================
-- TRIGGER FUNCTION: fn_actualizar_stock_venta (v2)
-- ==========================================
-- Se dispara automáticamente AFTER INSERT en ventas_detalles.
-- Por cada línea de venta:
--   1. Descuenta el stock del producto correcto:
--      - Padre-hijo: descuenta del HIJO (producto_stock_id) la cantidad_stock
--      - Normal: descuenta del producto_id la cantidad
--   2. Graba el movimiento en kardex_inventario (auditoría anti-fraude).
--
-- v2 — Padre-hijo: usa COALESCE(producto_stock_id, producto_id) y
--       COALESCE(cantidad_stock, cantidad) para descontar del hijo real.
--       Consistente con fn_anular_venta v1.2.
--
-- ⚠️  NO ejecutar manualmente. El trigger lo invoca el motor de PostgreSQL.
-- ⚠️  No borrar sin borrar también el trigger trg_descontar_stock_venta.
-- ==========================================
-- Usado por: trg_descontar_stock_venta (ON ventas_detalles AFTER INSERT)
-- ==========================================

CREATE OR REPLACE FUNCTION fn_actualizar_stock_venta()
RETURNS TRIGGER AS $$
DECLARE
    v_target_id    UUID          := COALESCE(NEW.producto_stock_id, NEW.producto_id);
    v_target_qty   DECIMAL(12,2) := COALESCE(NEW.cantidad_stock, NEW.cantidad);
    v_stock_actual DECIMAL(12,2);
BEGIN
    SELECT stock_actual INTO v_stock_actual
    FROM   productos
    WHERE  id = v_target_id;

    UPDATE productos
    SET    stock_actual = stock_actual - v_target_qty
    WHERE  id = v_target_id;

    INSERT INTO kardex_inventario (
        producto_id, tipo_movimiento, cantidad,
        stock_anterior, stock_nuevo, referencia_id, observaciones
    ) VALUES (
        v_target_id,
        'VENTA',
        v_target_qty,
        v_stock_actual,
        v_stock_actual - v_target_qty,
        NEW.venta_id,
        'Descuento automatico por Venta POS'
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_descontar_stock_venta
    AFTER INSERT ON ventas_detalles
    FOR EACH ROW
    EXECUTE FUNCTION fn_actualizar_stock_venta();
