-- ==========================================
-- DROP — descomentar SOLO si cambia la firma (parámetros o tipo de retorno)
-- ==========================================
-- DROP FUNCTION IF EXISTS public.registrar_venta_pos(
--   UUID, INTEGER, DECIMAL, DECIMAL, TEXT, JSONB
-- );

-- ==========================================
-- FUNCIÓN: registrar_venta_pos (v1.0)
-- ==========================================
-- Procesa una venta del POS en una transacción atómica.
-- Si CUALQUIER paso falla, PostgreSQL hace rollback automático completo.
--
-- Flujo interno:
--   1. Inserta encabezado en `ventas`
--   2. Inserta ítems en `ventas_detalles`
--   3. El Trigger `trg_descontar_stock_venta` descuenta el stock automáticamente
--   4. El Trigger `trg_actualizar_caja_por_venta` sube el saldo de CAJA si es EFECTIVO
--
-- Llamada desde: PosService.procesarVenta()
-- Parámetros:
--   p_turno_id     — UUID del turno activo (OBLIGATORIO — NOT NULL en ventas)
--   p_empleado_id  — ID del cajero que realiza la venta
--   p_total        — Monto total de la venta (sin descuentos en MVP)
--   p_subtotal     — Base antes de impuestos (= total en MVP tarifa 0%)
--   p_metodo_pago  — 'EFECTIVO' | 'DEUNA' | 'TRANSFERENCIA' | 'FIADO'
--   p_items        — JSONB array: [{producto_id, cantidad, precio_unitario, subtotal}]
-- ==========================================

CREATE OR REPLACE FUNCTION public.registrar_venta_pos(
  p_turno_id    UUID,
  p_empleado_id INTEGER,
  p_total       DECIMAL(12,2),
  p_subtotal    DECIMAL(12,2),
  p_metodo_pago TEXT    DEFAULT 'EFECTIVO',
  p_items       JSONB   DEFAULT '[]'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER                      -- ejecuta con permisos del creador
SET search_path = public              -- resolución explícita de schema
AS $$
DECLARE
  v_venta_id  UUID;
  v_item      JSONB;
BEGIN

  -- 1. Insertar la Venta maestra (cabecera)
  INSERT INTO ventas (
    turno_id,
    empleado_id,
    subtotal,
    total,
    metodo_pago,
    estado
  ) VALUES (
    p_turno_id,
    p_empleado_id,
    p_subtotal,
    p_total,
    p_metodo_pago,
    'COMPLETADA'
  )
  RETURNING id INTO v_venta_id;

  -- 2. Insertar los detalles (líneas de ítems)
  --    El trigger trg_descontar_stock_venta se ejecuta automáticamente
  --    por cada INSERT en ventas_detalles → descuenta stock + graba kardex
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO ventas_detalles (
      venta_id,
      producto_id,
      cantidad,
      precio_unitario,
      subtotal
    ) VALUES (
      v_venta_id,
      (v_item->>'producto_id')::UUID,
      (v_item->>'cantidad')::DECIMAL,
      (v_item->>'precio_unitario')::DECIMAL,
      (v_item->>'subtotal')::DECIMAL
    );
  END LOOP;

  -- 3. Retornar resultado exitoso
  RETURN json_build_object(
    'success',   true,
    'venta_id',  v_venta_id
  );

EXCEPTION WHEN OTHERS THEN
  -- PostgreSQL hace ROLLBACK automático de todo lo insertado en este bloque
  RAISE EXCEPTION 'Error al registrar venta POS: %', SQLERRM;
END;
$$;

-- Permisos
GRANT EXECUTE ON FUNCTION public.registrar_venta_pos(UUID, INTEGER, DECIMAL, DECIMAL, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_venta_pos(UUID, INTEGER, DECIMAL, DECIMAL, TEXT, JSONB) TO anon;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.registrar_venta_pos IS
  'Registra una venta completa del POS en transacción atómica. '
  'Inserta en ventas + ventas_detalles. '
  'Triggers automáticos manejan: descuento de stock (kardex) y actualización de caja. '
  'Rollback automático si cualquier paso falla.';
