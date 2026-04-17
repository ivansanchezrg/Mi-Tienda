-- ==========================================
-- TRIGGER FUNCTION: fn_actualizar_stock_venta (v4)
-- ==========================================
-- Se dispara automaticamente AFTER INSERT en ventas_detalles.
-- Por cada linea de venta:
--   1. Descuenta el stock del producto base:
--      - Con presentacion: cantidad * factor_conversion de producto_presentaciones
--      - Sin presentacion: cantidad directa (factor = 1)
--   2. Graba el movimiento en kardex_inventario (auditoria anti-fraude).
--
-- v4 — Mejoras de robustez:
--   • FOR UPDATE en SELECT de stock (evita race condition en ventas concurrentes)
--   • Valida v_factor IS NULL (presentacion_id invalida o no encontrada)
--   • Valida stock insuficiente antes de descontar (evita stock negativo)
--
-- v3 — Presentaciones: reemplaza modelo padre-hijo.
--       Si presentacion_id existe, obtiene factor_conversion de producto_presentaciones.
--       Stock siempre se descuenta de productos.stock_actual (unidad base).
--
-- ⚠️  NO ejecutar manualmente. El trigger lo invoca el motor de PostgreSQL.
-- ⚠️  No borrar sin borrar tambien el trigger trg_descontar_stock_venta.
-- ==========================================
-- Usado por: trg_descontar_stock_venta (ON ventas_detalles AFTER INSERT)
-- ==========================================

DROP TRIGGER IF EXISTS trg_descontar_stock_venta ON ventas_detalles;

CREATE OR REPLACE FUNCTION fn_actualizar_stock_venta()
RETURNS TRIGGER AS $$
DECLARE
    v_factor        INTEGER;
    v_cantidad_real DECIMAL(12,2);
    v_stock_actual  DECIMAL(12,2);
BEGIN
    -- Si tiene presentacion, obtener factor; sino, factor = 1 (venta directa)
    IF NEW.presentacion_id IS NOT NULL THEN
        SELECT factor_conversion INTO v_factor
        FROM producto_presentaciones
        WHERE id = NEW.presentacion_id;

        IF v_factor IS NULL THEN
            RAISE EXCEPTION 'Presentacion no valida o no encontrada: %', NEW.presentacion_id;
        END IF;
    ELSE
        v_factor := 1;
    END IF;

    v_cantidad_real := NEW.cantidad * v_factor;

    -- FOR UPDATE: bloquea la fila durante la transaccion (evita race condition en ventas concurrentes)
    SELECT stock_actual INTO v_stock_actual
    FROM   productos
    WHERE  id = NEW.producto_id
    FOR UPDATE;

    IF v_stock_actual < v_cantidad_real THEN
        RAISE EXCEPTION 'Stock insuficiente para producto %. Stock actual: %, requerido: %',
            NEW.producto_id, v_stock_actual, v_cantidad_real;
    END IF;

    UPDATE productos
    SET    stock_actual = stock_actual - v_cantidad_real
    WHERE  id = NEW.producto_id;

    INSERT INTO kardex_inventario (
        producto_id, tipo_movimiento, cantidad,
        stock_anterior, stock_nuevo, referencia_id, observaciones
    ) VALUES (
        NEW.producto_id,
        'VENTA',
        v_cantidad_real,
        v_stock_actual,
        v_stock_actual - v_cantidad_real,
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
