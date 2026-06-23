-- ==========================================
-- TRIGGER FUNCTION: fn_actualizar_stock_venta (v10)
-- ==========================================
-- Se dispara automáticamente AFTER INSERT en ventas_detalles.
-- Por cada línea de venta:
--   1. Bloquea la fila del producto (FOR UPDATE) para evitar race condition
--      en ventas concurrentes del mismo producto.
--   2. Valida que hay stock suficiente.
--   3. Descuenta el stock del producto vendido (respetando factor de presentacion si aplica).
--   4. Graba el movimiento en kardex_inventario (auditoría anti-fraude), con negocio_id y presentacion_id.
--
-- CAMBIOS v10 (schema v11 — multi-tenant UUID):
--   - v_factor: DECIMAL(12,4) (factor_conversion soporta fracciones: 0.5kg, 1.25L, etc.)
--   - Agrega FOR UPDATE lock en producto antes de leer stock (previene overselling concurrente)
--   - Agrega validación de stock insuficiente (RAISE EXCEPTION)
--   - Agrega v_negocio_id := get negocio del producto
--   - kardex_inventario INSERT incluye negocio_id (NOT NULL en schema)
--   - SECURITY DEFINER + SET search_path = public
--
-- ⚠️  NO ejecutar manualmente. El trigger lo invoca el motor de PostgreSQL.
-- ⚠️  No borrar sin borrar también el trigger trg_descontar_stock_venta.
-- ==========================================
-- Usado por: trg_descontar_stock_venta (ON ventas_detalles AFTER INSERT)
-- ==========================================

CREATE OR REPLACE FUNCTION fn_actualizar_stock_venta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id    UUID;
    v_factor        DECIMAL(12,4);
    v_cantidad_real DECIMAL(12,2);
    v_stock_actual  DECIMAL(12,2);
BEGIN
    -- Si tiene presentacion, obtener factor; sino, factor = 1 (venta directa)
    IF NEW.presentacion_id IS NOT NULL THEN
        v_factor := (SELECT factor_conversion FROM producto_presentaciones WHERE id = NEW.presentacion_id);

        IF v_factor IS NULL THEN
            RAISE EXCEPTION 'Presentacion no valida o no encontrada: %', NEW.presentacion_id;
        END IF;
    ELSE
        v_factor := 1.0;
    END IF;

    v_cantidad_real := NEW.cantidad * v_factor;

    -- Lock de fila: previene race condition en ventas concurrentes del mismo producto
    PERFORM id FROM productos WHERE id = NEW.producto_id FOR UPDATE;

    v_negocio_id   := (SELECT negocio_id  FROM productos WHERE id = NEW.producto_id);
    v_stock_actual := (SELECT stock_actual FROM productos WHERE id = NEW.producto_id);

    IF v_stock_actual < v_cantidad_real THEN
        RAISE EXCEPTION 'Stock insuficiente para producto %. Stock actual: %, requerido: %',
            NEW.producto_id, v_stock_actual, v_cantidad_real;
    END IF;

    UPDATE productos
    SET stock_actual = stock_actual - v_cantidad_real
    WHERE id = NEW.producto_id;

    INSERT INTO kardex_inventario (
        negocio_id,
        producto_id, tipo_movimiento, cantidad,
        stock_anterior, stock_nuevo,
        referencia_id, presentacion_id, observaciones
    ) VALUES (
        v_negocio_id,
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
$$;

DROP TRIGGER IF EXISTS trg_descontar_stock_venta ON ventas_detalles;

CREATE TRIGGER trg_descontar_stock_venta
    AFTER INSERT ON ventas_detalles
    FOR EACH ROW
    EXECUTE FUNCTION fn_actualizar_stock_venta();
