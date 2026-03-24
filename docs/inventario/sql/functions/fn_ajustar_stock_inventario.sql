-- ==========================================
-- FUNCIÓN: fn_ajustar_stock_inventario
-- ==========================================
-- Ajusta el stock de un producto de forma atómica:
--   1. Valida que no quede stock negativo
--   2. Actualiza productos.stock_actual
--   3. Inserta registro en kardex_inventario
--
-- Tipos de ajuste:
--   - COMPRA: ingreso de mercadería (suma stock)
--   - AJUSTE_POSITIVO: corrección por conteo físico a favor (suma stock)
--   - AJUSTE_NEGATIVO: producto dañado, merma, corrección (resta stock)
--
-- Ejecutar: una sola vez en Supabase SQL Editor.
-- ==========================================

CREATE OR REPLACE FUNCTION fn_ajustar_stock_inventario(
    p_producto_id UUID,
    p_tipo_movimiento TEXT,
    p_cantidad DECIMAL(12,2),
    p_observaciones TEXT
)
RETURNS JSON AS $$
DECLARE
    v_stock_actual DECIMAL(12,2);
    v_stock_nuevo DECIMAL(12,2);
    v_kardex_id UUID;
BEGIN
    -- Validaciones
    IF p_cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
    END IF;

    IF p_tipo_movimiento NOT IN ('COMPRA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO') THEN
        RAISE EXCEPTION 'Tipo de movimiento no válido: %. Use COMPRA, AJUSTE_POSITIVO o AJUSTE_NEGATIVO', p_tipo_movimiento;
    END IF;

    IF COALESCE(TRIM(p_observaciones), '') = '' THEN
        RAISE EXCEPTION 'Las observaciones son obligatorias para ajustes de stock';
    END IF;

    -- Obtener stock actual con bloqueo de fila
    SELECT stock_actual INTO v_stock_actual
    FROM productos
    WHERE id = p_producto_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Producto no encontrado';
    END IF;

    -- Calcular nuevo stock
    IF p_tipo_movimiento IN ('COMPRA', 'AJUSTE_POSITIVO') THEN
        v_stock_nuevo := v_stock_actual + p_cantidad;
    ELSE
        v_stock_nuevo := v_stock_actual - p_cantidad;
    END IF;

    IF v_stock_nuevo < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente. Stock actual: %, cantidad a restar: %', v_stock_actual, p_cantidad;
    END IF;

    -- Actualizar stock del producto
    UPDATE productos
    SET stock_actual = v_stock_nuevo
    WHERE id = p_producto_id;

    -- Registrar en kardex
    INSERT INTO kardex_inventario (producto_id, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, observaciones)
    VALUES (p_producto_id, p_tipo_movimiento, p_cantidad, v_stock_actual, v_stock_nuevo, p_observaciones)
    RETURNING id INTO v_kardex_id;

    RETURN json_build_object(
        'success', TRUE,
        'kardex_id', v_kardex_id,
        'stock_anterior', v_stock_actual,
        'stock_nuevo', v_stock_nuevo,
        'tipo_movimiento', p_tipo_movimiento,
        'cantidad', p_cantidad
    );
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

-- Permisos
GRANT EXECUTE ON FUNCTION fn_ajustar_stock_inventario(UUID, TEXT, DECIMAL, TEXT) TO authenticated;

-- Recargar schema de PostgREST
NOTIFY pgrst, 'reload schema';
