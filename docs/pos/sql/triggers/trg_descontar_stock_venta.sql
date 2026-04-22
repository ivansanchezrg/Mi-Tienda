-- ==========================================
-- TRIGGER FUNCTION: fn_actualizar_stock_venta (v8)
-- ==========================================
-- Se dispara automáticamente AFTER INSERT en ventas_detalles.
-- Por cada línea de venta:
--   1. Descuenta el stock del producto vendido (respetando factor de presentacion si aplica).
--   2. Graba el movimiento en kardex_inventario (auditoría anti-fraude), con presentacion_id.
--
-- v8 — Soporta presentaciones:
--   Si presentacion_id existe, multiplica cantidad * factor_conversion antes de descontar.
--   Stock siempre se descuenta de productos.stock_actual (unidad base).
--   El kardex graba la cantidad REAL descontada (ya multiplicada) y guarda presentacion_id.
--
-- ⚠️  NO ejecutar manualmente. El trigger lo invoca el motor de PostgreSQL.
-- ⚠️  No borrar sin borrar también el trigger trg_descontar_stock_venta.
-- ==========================================
-- Usado por: trg_descontar_stock_venta (ON ventas_detalles AFTER INSERT)
-- ==========================================

CREATE OR REPLACE FUNCTION fn_actualizar_stock_venta()
RETURNS TRIGGER AS $$
DECLARE
    v_stock_actual  DECIMAL(12,2);
    v_factor        DECIMAL(10,4);
    v_cantidad_real DECIMAL(12,2);
BEGIN
    -- Si tiene presentacion, obtener factor; sino, factor = 1 (venta directa)
    IF NEW.presentacion_id IS NOT NULL THEN
        v_factor := (SELECT factor_conversion FROM producto_presentaciones WHERE id = NEW.presentacion_id);

        IF v_factor IS NULL THEN
            RAISE EXCEPTION 'Presentacion no valida o no encontrada: %', NEW.presentacion_id;
        END IF;
    ELSE
        v_factor := 1;
    END IF;

    v_cantidad_real := NEW.cantidad * v_factor;
    v_stock_actual  := (SELECT stock_actual FROM productos WHERE id = NEW.producto_id);

    UPDATE productos
    SET stock_actual = stock_actual - v_cantidad_real
    WHERE id = NEW.producto_id;

    INSERT INTO kardex_inventario (
        producto_id, tipo_movimiento, cantidad,
        stock_anterior, stock_nuevo,
        referencia_id, presentacion_id, observaciones
    ) VALUES (
        NEW.producto_id,
        'VENTA',
        v_cantidad_real,
        v_stock_actual,
        v_stock_actual - v_cantidad_real,
        NEW.venta_id,
        NEW.presentacion_id,
        'Descuento automatico por Venta POS'
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_descontar_stock_venta ON ventas_detalles;

CREATE TRIGGER trg_descontar_stock_venta
    AFTER INSERT ON ventas_detalles
    FOR EACH ROW
    EXECUTE FUNCTION fn_actualizar_stock_venta();
