-- ==========================================
-- MIGRACIÓN — Stock negativo para ventas offline (Fase 6 PLAN-OFFLINE-POS)
-- Fecha: 2026-06-10
-- ==========================================
-- Habilita que las ventas drenadas desde la cola offline (SyncService) se registren
-- aunque el stock real haya bajado entre el cacheo y el sync. El stock offline es
-- OPTIMISTA (§5): la venta ya ocurrió físicamente, negarla descuadraría la caja.
--
-- Ejecutar este archivo COMPLETO en Supabase SQL Editor. Es idempotente y seguro
-- de re-ejecutar. Reemplaza los "pasos 1/2/3" sueltos del plan.
--
-- Mecanismo: variable de sesión transaccional. fn_registrar_venta_pos hace
--   set_config('app.permitir_stock_negativo','on', true)  -- is_local=true → solo esta TX
-- y el trigger fn_actualizar_stock_venta la lee con current_setting(...,true).
-- Las ventas online normales no setean nada → el trigger mantiene el RAISE.
-- ==========================================

-- ── 1. Quitar el CHECK de columna ──
-- Un CHECK no puede leer variables de sesión, así que bloquearía las ventas offline
-- legítimas. El guardián del stock pasa a ser SOLO el trigger (que sí respeta la bandera).
ALTER TABLE productos DROP CONSTRAINT IF EXISTS chk_stock_no_negativo;

-- ── 2. Trigger de stock — versión con bandera de venta offline ──
CREATE OR REPLACE FUNCTION fn_actualizar_stock_venta()
RETURNS TRIGGER AS $$
DECLARE
    v_negocio_id     UUID;
    v_factor         INTEGER;
    v_cantidad_real  DECIMAL(12,2);
    v_stock_actual   DECIMAL(12,2);
    v_permitir_neg   BOOLEAN;
BEGIN
    IF NEW.presentacion_id IS NOT NULL THEN
        v_factor := (SELECT factor_conversion FROM producto_presentaciones WHERE id = NEW.presentacion_id);
        IF v_factor IS NULL THEN
            RAISE EXCEPTION 'Presentacion no valida o no encontrada: %', NEW.presentacion_id;
        END IF;
    ELSE
        v_factor := 1;
    END IF;

    v_cantidad_real := NEW.cantidad * v_factor;

    PERFORM id FROM productos WHERE id = NEW.producto_id FOR UPDATE;
    v_negocio_id   := (SELECT negocio_id   FROM productos WHERE id = NEW.producto_id);
    v_stock_actual := (SELECT stock_actual  FROM productos WHERE id = NEW.producto_id);

    -- Bandera de venta offline: la setea fn_registrar_venta_pos en la misma transacción.
    -- current_setting con true → no lanza si la variable no existe (ventas online normales).
    v_permitir_neg := COALESCE(current_setting('app.permitir_stock_negativo', true), 'off') = 'on';

    IF v_stock_actual < v_cantidad_real AND NOT v_permitir_neg THEN
        RAISE EXCEPTION 'Stock insuficiente para producto %. Stock actual: %, requerido: %',
            NEW.producto_id, v_stock_actual, v_cantidad_real;
    END IF;

    UPDATE productos
    SET stock_actual = stock_actual - v_cantidad_real
    WHERE id = NEW.producto_id;

    INSERT INTO kardex_inventario (negocio_id, producto_id, tipo_movimiento, cantidad,
        stock_anterior, stock_nuevo, referencia_id, presentacion_id, observaciones)
    VALUES (v_negocio_id, NEW.producto_id, 'VENTA', v_cantidad_real,
        v_stock_actual, v_stock_actual - v_cantidad_real,
        NEW.venta_id, NEW.presentacion_id, 'Descuento automatico por Venta POS');

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- El trigger trg_descontar_stock_venta ya existe y apunta a esta función — no se recrea.

-- ── 3. Recordatorio ──
-- Falta ejecutar también la función fn_registrar_venta_pos v3.1 (parámetro
-- p_permitir_stock_negativo) desde:
--   docs/pos/sql/functions/fn_registrar_venta_pos.sql

NOTIFY pgrst, 'reload schema';
