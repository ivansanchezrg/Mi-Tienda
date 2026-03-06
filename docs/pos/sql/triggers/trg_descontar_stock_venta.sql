-- ==========================================
-- TRIGGER FUNCTION: fn_actualizar_stock_venta
-- ==========================================
-- Se dispara automáticamente AFTER INSERT en ventas_detalles.
-- Por cada línea de venta:
--   1. Descuenta el stock del producto vendido.
--   2. Graba el movimiento en kardex_inventario (auditoría anti-fraude).
--
-- ⚠️  NO ejecutar manualmente. El trigger lo invoca el motor de PostgreSQL.
-- ⚠️  No borrar sin borrar también el trigger trg_descontar_stock_venta.
-- ==========================================
-- Usado por: trg_descontar_stock_venta (ON ventas_detalles AFTER INSERT)
-- ==========================================

CREATE OR REPLACE FUNCTION fn_actualizar_stock_venta()
RETURNS TRIGGER AS $$
DECLARE
    v_stock_actual DECIMAL(12,2);
BEGIN
    SELECT stock_actual INTO v_stock_actual FROM productos WHERE id = NEW.producto_id;

    UPDATE productos
    SET stock_actual = stock_actual - NEW.cantidad
    WHERE id = NEW.producto_id;

    INSERT INTO kardex_inventario (
        producto_id, tipo_movimiento, cantidad,
        stock_anterior, stock_nuevo, referencia_id, observaciones
    ) VALUES (
        NEW.producto_id,
        'VENTA',
        NEW.cantidad,
        v_stock_actual,
        v_stock_actual - NEW.cantidad,
        NEW.venta_id,
        'Descuento automático por Venta POS'
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_descontar_stock_venta
    AFTER INSERT ON ventas_detalles
    FOR EACH ROW
    EXECUTE FUNCTION fn_actualizar_stock_venta();
