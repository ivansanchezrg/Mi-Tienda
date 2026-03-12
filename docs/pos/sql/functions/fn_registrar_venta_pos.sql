-- ==========================================
-- DROP — solo si la firma cambia: descomentar y ejecutar UNA VEZ antes del CREATE
-- ==========================================
-- DROP FUNCTION IF EXISTS public.registrar_venta_pos(
--   UUID, INTEGER, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB
-- );

-- ==========================================
-- FUNCIÓN: registrar_venta_pos (v1.3)
-- ==========================================
-- Procesa una venta del POS en una transacción atómica.
-- Si CUALQUIER paso falla, PostgreSQL hace rollback automático completo.
--
-- Flujo interno:
--   1. Obtiene el siguiente numero_comprobante de secuencias_comprobantes
--      usando UPDATE ... RETURNING (atómico, sin race conditions)
--   2. Inserta encabezado en `ventas` con todos los campos fiscales + numero_comprobante
--   3. Inserta ítems en `ventas_detalles`
--   4. El Trigger `trg_descontar_stock_venta` descuenta el stock automáticamente
--   5. El Trigger `trg_actualizar_caja_por_venta` sube el saldo de CAJA_CHICA si es EFECTIVO
--
-- Prerequisito: ejecutar primero secuencias_comprobantes.sql
--
-- Llamada desde: PosService.procesarVenta()
-- Parámetros:
--   p_turno_id          — UUID del turno activo (NOT NULL en ventas)
--   p_empleado_id       — ID del cajero
--   p_cliente_id        — UUID del cliente (NULL = Consumidor Final)
--   p_tipo_comprobante  — 'TICKET' | 'NOTA_VENTA' | 'FACTURA'
--   p_total             — Monto total cobrado al cliente (incluye IVA si aplica)
--   p_subtotal          — Base neta sin IVA (= total en TICKET/NOTA_VENTA, = base0+base15 en FACTURA)
--   p_base_iva_0        — Base gravada 0% (solo FACTURA, sino 0)
--   p_base_iva_15       — Base gravada 15% antes de IVA (solo FACTURA, sino 0)
--   p_iva_valor         — Valor del IVA 15% extraído (solo FACTURA, sino 0)
--   p_metodo_pago       — 'EFECTIVO' | 'DEUNA' | 'TRANSFERENCIA' | 'FIADO'
--   p_items             — JSONB array: [{producto_id, cantidad, precio_unitario, subtotal}]
-- ==========================================

CREATE OR REPLACE FUNCTION public.registrar_venta_pos(
  p_turno_id         UUID,
  p_empleado_id      INTEGER,
  p_cliente_id       UUID             DEFAULT NULL,
  p_tipo_comprobante TEXT             DEFAULT 'TICKET',
  p_total            DECIMAL(12,2)    DEFAULT 0,
  p_subtotal         DECIMAL(12,2)    DEFAULT 0,
  p_base_iva_0       DECIMAL(12,2)    DEFAULT 0,
  p_base_iva_15      DECIMAL(12,2)    DEFAULT 0,
  p_iva_valor        DECIMAL(12,2)    DEFAULT 0,
  p_metodo_pago      TEXT             DEFAULT 'EFECTIVO',
  p_items            JSONB            DEFAULT '[]'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_venta_id           UUID;
  v_item               JSONB;
  v_numero_comprobante INTEGER;
BEGIN

  -- 1. Obtener el siguiente número de comprobante de forma atómica.
  --    UPDATE ... RETURNING bloquea solo la fila del tipo correspondiente
  --    por milisegundos → cero colisiones bajo concurrencia.
  UPDATE secuencias_comprobantes
  SET    ultimo_valor = ultimo_valor + 1
  WHERE  tipo_documento = p_tipo_comprobante
  RETURNING ultimo_valor INTO v_numero_comprobante;

  -- Si el tipo no existe en la tabla, abortar con mensaje claro
  IF v_numero_comprobante IS NULL THEN
    RAISE EXCEPTION 'Tipo de comprobante no registrado en secuencias_comprobantes: %', p_tipo_comprobante;
  END IF;

  -- 2. Insertar la Venta maestra con todos los campos fiscales + numero_comprobante
  INSERT INTO ventas (
    turno_id,
    cliente_id,
    empleado_id,
    tipo_comprobante,
    numero_comprobante,
    subtotal,
    total,
    base_iva_0,
    base_iva_15,
    iva_valor,
    metodo_pago,
    estado
  ) VALUES (
    p_turno_id,
    p_cliente_id,
    p_empleado_id,
    p_tipo_comprobante::tipo_comprobante_enum,
    v_numero_comprobante,
    p_subtotal,
    p_total,
    p_base_iva_0,
    p_base_iva_15,
    p_iva_valor,
    p_metodo_pago,
    'COMPLETADA'
  )
  RETURNING id INTO v_venta_id;

  -- 3. Insertar los detalles (líneas de ítems)
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

  -- 4. Retornar resultado exitoso con numero_comprobante para mostrar/imprimir
  RETURN json_build_object(
    'success',            true,
    'venta_id',           v_venta_id,
    'numero_comprobante', v_numero_comprobante
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Error al registrar venta POS: %', SQLERRM;
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.registrar_venta_pos(UUID, INTEGER, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB) FROM anon;
GRANT  EXECUTE ON FUNCTION public.registrar_venta_pos(UUID, INTEGER, UUID, TEXT, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, TEXT, JSONB) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.registrar_venta_pos IS
  'v1.3 — Agrega numero_comprobante secuencial por tipo vía secuencias_comprobantes (UPDATE...RETURNING). '
  'Registra venta completa del POS en transacción atómica. '
  'Triggers automáticos: descuento de stock (kardex) y actualización de CAJA_CHICA. '
  'Campos SRI (secuencial_sri, clave_acceso_sri, estado_sri) dormidos para fase futura.';
