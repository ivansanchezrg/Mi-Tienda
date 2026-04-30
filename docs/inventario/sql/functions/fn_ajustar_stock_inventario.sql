-- ==========================================
-- FUNCIÓN: fn_ajustar_stock_inventario (v1.0)
-- ==========================================
-- Ajusta el stock de un producto manualmente y registra el movimiento
-- en kardex_inventario (auditoría). Usado desde la página de Kárdex.
--
-- Tipos de movimiento válidos:
--   COMPRA          → (+) Entrada por compra de mercadería
--   AJUSTE_POSITIVO → (+) Corrección manual a favor (inventario físico)
--   AJUSTE_NEGATIVO → (-) Corrección manual en contra (merma, daño, pérdida)
--
-- Llamada desde: InventarioService.ajustarStock()
-- Parámetros:
--   p_producto_id     — UUID del producto a ajustar (debe ser producto base, no empaque)
--   p_tipo_movimiento — 'COMPRA' | 'AJUSTE_POSITIVO' | 'AJUSTE_NEGATIVO'
--   p_cantidad        — Cantidad a sumar o restar (siempre positiva)
--   p_observaciones   — Motivo del ajuste (obligatorio)
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_ajustar_stock_inventario(
    p_producto_id     UUID,
    p_tipo_movimiento TEXT,
    p_cantidad        DECIMAL(12,2),
    p_observaciones   TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id     UUID;
    v_stock_anterior DECIMAL(12,2);
    v_stock_nuevo    DECIMAL(12,2);
    v_delta          DECIMAL(12,2);
BEGIN
    v_negocio_id := public.get_negocio_id();

    -- 1. Validaciones básicas
    IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad debe ser mayor a cero';
    END IF;

    IF p_observaciones IS NULL OR TRIM(p_observaciones) = '' THEN
        RAISE EXCEPTION 'Las observaciones son obligatorias';
    END IF;

    IF p_tipo_movimiento NOT IN ('COMPRA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO') THEN
        RAISE EXCEPTION 'Tipo de movimiento inválido: %. Use COMPRA, AJUSTE_POSITIVO o AJUSTE_NEGATIVO', p_tipo_movimiento;
    END IF;

    -- 2. Leer stock actual y bloquear la fila (FOR UPDATE evita race conditions)
    -- ⚠️  Supabase no soporta SELECT ... INTO — usar := (SELECT ...)
    PERFORM id FROM productos WHERE id = p_producto_id FOR UPDATE;

    v_stock_anterior := (SELECT stock_actual FROM productos WHERE id = p_producto_id);

    IF v_stock_anterior IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado: %', p_producto_id;
    END IF;

    -- 3. Calcular delta según tipo
    IF p_tipo_movimiento = 'AJUSTE_NEGATIVO' THEN
        v_delta = -p_cantidad;
    ELSE
        v_delta = p_cantidad;
    END IF;

    v_stock_nuevo := v_stock_anterior + v_delta;

    IF v_stock_nuevo < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente. Stock actual: %, ajuste solicitado: -%', v_stock_anterior, p_cantidad;
    END IF;

    -- 4. Actualizar stock
    UPDATE productos
    SET    stock_actual = v_stock_nuevo
    WHERE  id = p_producto_id;

    -- 5. Registrar en kardex
    INSERT INTO kardex_inventario (
        negocio_id,
        producto_id,
        tipo_movimiento,
        cantidad,
        stock_anterior,
        stock_nuevo,
        observaciones
    ) VALUES (
        v_negocio_id,
        p_producto_id,
        p_tipo_movimiento,
        p_cantidad,
        v_stock_anterior,
        v_stock_nuevo,
        TRIM(p_observaciones)
    );

    -- 6. Retornar el stock resultante
    RETURN json_build_object(
        'success',       true,
        'stock_nuevo',   v_stock_nuevo,
        'stock_anterior', v_stock_anterior,
        'delta',         v_delta
    );

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al ajustar stock: %', SQLERRM;
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_ajustar_stock_inventario(UUID, TEXT, DECIMAL, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_ajustar_stock_inventario(UUID, TEXT, DECIMAL, TEXT) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_ajustar_stock_inventario IS
    'v1.0 — Ajuste manual de stock desde el Kárdex. '
    'Tipos: COMPRA (+), AJUSTE_POSITIVO (+), AJUSTE_NEGATIVO (-). '
    'Valida stock suficiente antes de restar. '
    'Registra movimiento en kardex_inventario. '
    'Usa FOR UPDATE para evitar race conditions en concurrencia.';
